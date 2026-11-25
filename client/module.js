import net from 'node:net';

const MAX_LINE = 64 << 10;
const STALE_MS = 2000;
const finite = (list, n) => Array.isArray(list) && list.length === n && list.every(Number.isFinite);

/**
 * Client du module SixM dans VIctory (integrations/victory/sixm-bridge) : position du joueur et caméra,
 * lues dans le jeu grâce à un profil local. Se reconnecte tant que le jeu tourne.
 */
export class GameModule {
  constructor({ port, token, retryMs = 1000, onCamera = () => {} }) {
    Object.assign(this, { port, token, retryMs, onCamera });
    this.connected = false;
    this.build = null;
    this.profile = false;
    this.error = null;
    this.stopped = false;
    this.local = null;
    this.seen = 0;
    this.#connect();
  }

  /** Position du joueur, ou null si le jeu n'en donne plus. */
  get position() { return this.local && performance.now() - this.seen < STALE_MS ? this.local : null; }

  state() {
    const { connected, build, profile, error } = this;
    return { connected, build, profile, error, located: !!this.position };
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.sock?.destroy();
  }

  #connect() {
    if (this.stopped) return;
    const sock = this.sock = net.connect({ host: '127.0.0.1', port: this.port });
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(`${this.token}\n`));
    sock.on('data', (d) => {
      buf += d;
      if (buf.length > MAX_LINE) return sock.destroy();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m && typeof m === 'object') this.#message(m);
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      Object.assign(this, { connected: false, local: null });
      if (!this.stopped) this.timer = setTimeout(() => this.#connect(), this.retryMs);
    });
  }

  #message(m) {
    this.connected = true;
    if (m.t === 'ready') {
      this.build = /^[0-9a-f]{1,8}-[0-9a-f]{1,8}$/.test(m.build) ? m.build : null;
      this.profile = m.profile === true;
      this.error = typeof m.error === 'string' ? m.error.slice(0, 200) : null;
    } else if (m.t === 'localPlayer' && finite([m.x, m.y, m.z, m.h], 4)) {
      this.local = { x: m.x, y: m.y, z: m.z, h: m.h };
      this.seen = performance.now();
    } else if (m.t === 'camera' && finite(m.m, 16)) this.onCamera(m.m);
  }
}
