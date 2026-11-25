import net from 'node:net';
import { GameAdapter } from '../adapter.js';

const MAX_LINE = 1 << 20;
const READY_TIMEOUT_MS = 5000;

/**
 * Adaptateur SixM pour VIctory (https://github.com/Marvisak/VIctory), couche de
 * compatibilité qui fait tourner GTA VI (Xbox Series) sous Windows.
 *
 * VIctory n'expose pas (encore) d'API de plugin : ce côté-ci parle un protocole
 * NDJSON local (voir integrations/victory/PROTOCOL.md) à un module « bridge »
 * qui doit vivre dans le processus VIctory et qui, lui seul, connaît les offsets
 * du build (fichier de profil local, jamais commité).
 *
 * Si le bridge tombe, l'adaptateur se reconnecte et lui renvoie les avatars distants.
 */
export class VictoryAdapter extends GameAdapter {
  constructor({ host = '127.0.0.1', port = 30121, allowedBuilds = null, connectTimeoutMs = 30000, retryMs = 500 } = {}) {
    super();
    // Le bridge donne accès à la mémoire du jeu : loopback uniquement.
    if (!['127.0.0.1', '::1', 'localhost'].includes(host))
      throw new Error('VictoryAdapter: seul le loopback est autorisé');
    Object.assign(this, { host, port, allowedBuilds, connectTimeoutMs, retryMs });
    this.pos = null; // inconnue tant que le bridge n'a rien envoyé
    this.build = null;
    this.logs = [];
    this.remotes = new Map();
    this.closing = false;
  }

  async init() {
    this.closing = false;
    await this.#connectWithRetry(Date.now() + this.connectTimeoutMs);
  }

  async #connectWithRetry(deadline) {
    for (;;) {
      try { return await this.#connectOnce(); }
      catch (e) {
        if (e.fatal || this.closing || Date.now() > deadline) throw e;
        await new Promise((r) => setTimeout(r, this.retryMs));
        if (this.closing) throw e;
      }
    }
  }

  #connectOnce() {
    return new Promise((resolve, reject) => {
      const sock = this.pending = net.connect({ host: this.host, port: this.port });
      let buf = '';
      let ready = false;
      const timer = setTimeout(() => sock.destroy(new Error('bridge: pas de message "ready"')), READY_TIMEOUT_MS);
      sock.setEncoding('utf8');
      sock.on('error', (e) => { if (!ready) reject(e); });
      sock.on('data', (d) => {
        buf += d;
        if (buf.length > MAX_LINE) return sock.destroy(new Error('bridge: message trop gros'));
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (!m || typeof m !== 'object') continue;
          if (m.t === 'ready' && !ready) {
            clearTimeout(timer);
            if (this.allowedBuilds && !this.allowedBuilds.includes(m.build)) {
              const err = new Error(`build non pris en charge: ${m.build}`); err.fatal = true;
              reject(err);
              sock.destroy();
              return;
            }
            ready = true;
            this.build = m.build; this.sock = sock;
            for (const [id, r] of this.remotes) this.#send({ t: 'setRemote', id, name: r.name, ...r.pos });
            resolve();
          } else if (ready && m.t === 'localPlayer' && [m.x, m.y, m.z, m.h].every(Number.isFinite)) {
            this.pos = { x: m.x, y: m.y, z: m.z, h: m.h };
          }
        }
      });
      sock.on('close', () => {
        clearTimeout(timer);
        if (!ready) return reject(new Error('bridge: connexion fermée avant "ready"'));
        this.sock = null;
        this.pos = null;
        if (!this.closing) this.#reconnect();
      });
    });
  }

  async #reconnect() {
    console.warn('[victory] bridge perdu, reconnexion…');
    try {
      await this.#connectWithRetry(Infinity);
      console.log('[victory] bridge reconnecté');
    } catch (e) {
      if (!this.closing) console.error(`[victory] reconnexion abandonnée : ${e.message}`);
    }
  }

  #send(m) {
    // Un bridge figé ne doit pas faire grossir la mémoire : on saute des positions, pas le reste.
    if (m.t === 'setRemote' && this.sock?.writableLength > MAX_LINE) return;
    this.sock?.write(JSON.stringify(m) + '\n');
  }

  getLocalPlayerPosition() { return this.pos; }
  setRemotePlayer(id, name, pos) {
    this.remotes.set(id, { name, pos });
    this.#send({ t: 'setRemote', id, name, ...pos });
  }
  removeRemotePlayer(id) {
    this.remotes.delete(id);
    this.#send({ t: 'removeRemote', id });
  }
  log(text) { this.logs.push(text); this.#send({ t: 'log', text }); console.log(`[game] ${text}`); }
  async shutdown() { this.closing = true; (this.sock ?? this.pending)?.end(); }
}
