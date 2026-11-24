import vm from 'node:vm';
import WebSocket from 'ws';

/** Client SixM : connexion, sync de position, exécution des scripts client des ressources. */
export class SixMClient {
  constructor({ url, name, adapter, posIntervalMs = 50 }) {
    Object.assign(this, { url, name, adapter, posIntervalMs });
    this.handlers = new Map();
    this.id = null;
    this.players = [];
  }

  async connect() {
    await this.adapter.init();
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.send(JSON.stringify({ t: 'hello', name: this.name }));
    const welcomed = new Promise((res) => (this.onWelcome = res));
    this.ws.on('message', (raw) => this.#onMessage(JSON.parse(raw)));
    await welcomed;
    this.posTimer = setInterval(() => {
      const { x, y, z, h } = this.adapter.getLocalPlayerPosition();
      this.#send({ t: 'pos', x, y, z, h });
    }, this.posIntervalMs);
  }

  emitServer(name, ...args) { this.#send({ t: 'event', name, args }); }

  async disconnect() {
    clearInterval(this.posTimer);
    this.ws?.close();
    await this.adapter.shutdown();
  }

  #send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  #loadResources(bundle) {
    const api = {
      on: (n, fn) => { (this.handlers.get(n) ?? this.handlers.set(n, []).get(n)).push(fn); },
      emitServer: (n, ...a) => this.emitServer(n, ...a),
      log: (t) => this.adapter.log(String(t)),
    };
    for (const res of bundle) {
      const ctx = vm.createContext({ sixm: api, console }, { codeGeneration: { strings: false, wasm: false } });
      for (const f of res.files) new vm.Script(f.source, { filename: `${res.name}/${f.file}` }).runInContext(ctx, { timeout: 2000 });
    }
  }

  #onMessage(m) {
    if (m.t === 'welcome') {
      this.id = m.id;
      this.#loadResources(m.resources);
      this.onWelcome(m);
    } else if (m.t === 'snapshot') {
      const seen = new Set();
      for (const p of m.players) {
        if (p.id === this.id) continue;
        seen.add(p.id);
        this.adapter.setRemotePlayer(p.id, p.name, p.pos);
      }
      for (const p of this.players) if (p.id !== this.id && !seen.has(p.id)) this.adapter.removeRemotePlayer(p.id);
      this.players = m.players;
    } else if (m.t === 'event') {
      for (const fn of this.handlers.get(m.name) ?? []) {
        try { fn(...m.args); } catch (e) { console.error(e); }
      }
    } else if (m.t === 'kick') {
      this.adapter.log(`Déconnecté: ${m.reason}`);
    }
  }
}
