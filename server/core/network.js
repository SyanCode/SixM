import { WebSocketServer } from 'ws';

/**
 * Protocole JSON sur WebSocket (voir docs/PROTOCOL.md).
 * client -> serveur : hello | pos | event
 * serveur -> client : welcome | snapshot | event | kick
 */
export class Network {
  constructor({ port, world, events, config, resources }) {
    Object.assign(this, { port, world, events, config, resources });
    this.rate = new WeakMap();
  }

  start() {
    this.wss = new WebSocketServer({ port: this.port, maxPayload: 64 * 1024 });
    this.wss.on('connection', (ws) => this.#onConnection(ws));
    this.timer = setInterval(() => this.#tick(), 1000 / this.config.tickRate);
    return new Promise((res) => this.wss.on('listening', () => {
      this.port = this.wss.address().port;
      res(this.port);
    }));
  }

  stop() {
    clearInterval(this.timer);
    for (const c of this.wss.clients) c.terminate();
    return new Promise((res) => this.wss.close(res));
  }

  send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  broadcast(msg) { for (const p of this.world.players.values()) this.send(p.socket, msg); }
  sendToPlayer(id, msg) { const p = this.world.players.get(id); if (p) this.send(p.socket, msg); }
  kick(id, reason = 'kicked') {
    const p = this.world.players.get(id);
    if (!p) return;
    this.send(p.socket, { t: 'kick', reason });
    p.socket.close();
  }

  #onConnection(ws) {
    let player = null;
    const helloTimeout = setTimeout(() => ws.close(), 5000);

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return ws.close(); }
      if (!this.#allow(ws)) return ws.close();

      if (!player) {
        if (m.t !== 'hello' || typeof m.name !== 'string') return ws.close();
        if (this.world.players.size >= this.config.maxPlayers) {
          this.send(ws, { t: 'kick', reason: 'serveur plein' });
          return ws.close();
        }
        clearTimeout(helloTimeout);
        const name = m.name.replace(/[^\p{L}\p{N}_ -]/gu, '').slice(0, 24) || 'Joueur';
        player = this.world.addPlayer(name, ws);
        this.send(ws, {
          t: 'welcome', id: player.id, server: this.config.name,
          tickRate: this.config.tickRate, resources: this.resources.clientBundle(),
        });
        this.events.emit('playerConnected', player);
        return;
      }

      if (m.t === 'pos') {
        const { x, y, z, h } = m;
        if ([x, y, z, h].every(Number.isFinite)) player.pos = { x, y, z, h };
      } else if (m.t === 'event' && typeof m.name === 'string') {
        // Les évènements réseau sont préfixés pour ne pas écraser les évènements internes.
        this.events.emit(`net:${m.name}`, player, ...(Array.isArray(m.args) ? m.args : []));
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimeout);
      if (!player) return;
      this.world.removePlayer(player.id);
      this.events.emit('playerDropped', player);
    });
    ws.on('error', () => {});
  }

  // Limite simple : 200 messages / seconde / connexion
  #allow(ws) {
    const now = Date.now();
    const r = this.rate.get(ws) ?? { start: now, n: 0 };
    if (now - r.start > 1000) { r.start = now; r.n = 0; }
    this.rate.set(ws, r);
    return ++r.n <= 200;
  }

  #tick() {
    if (this.world.players.size) this.broadcast({ t: 'snapshot', players: this.world.snapshot() });
  }
}
