import net from 'node:net';
import { GameAdapter } from '../adapter.js';

/**
 * Adaptateur SixM pour VIctory (https://github.com/Marvisak/VIctory), couche de
 * compatibilité qui fait tourner GTA VI (Xbox Series) sous Windows.
 *
 * VIctory n'expose pas (encore) d'API de plugin : ce côté-ci parle un protocole
 * NDJSON local (voir integrations/victory/PROTOCOL.md) à un module « bridge »
 * qui doit vivre dans le processus VIctory et qui, lui seul, connaît les offsets
 * du build (fichier de profil local, jamais commité).
 */
export class VictoryAdapter extends GameAdapter {
  constructor({ host = '127.0.0.1', port = 30121, allowedBuilds = null, connectTimeoutMs = 30000 } = {}) {
    super();
    // Le bridge donne accès à la mémoire du jeu : loopback uniquement.
    if (!['127.0.0.1', '::1', 'localhost'].includes(host))
      throw new Error('VictoryAdapter: seul le loopback est autorisé');
    Object.assign(this, { host, port, allowedBuilds, connectTimeoutMs });
    this.pos = { x: 0, y: 0, z: 0, h: 0 };
    this.build = null;
    this.logs = [];
  }

  async init() {
    const deadline = Date.now() + this.connectTimeoutMs;
    for (;;) {
      try { return await this.#connectOnce(); }
      catch (e) {
        if (e.fatal || Date.now() > deadline) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  #connectOnce() {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: this.host, port: this.port });
      let buf = '';
      sock.setEncoding('utf8');
      sock.once('error', reject);
      sock.on('data', (d) => {
        buf += d;
        if (buf.length > 1 << 20) return sock.destroy(new Error('bridge: message trop gros'));
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.t === 'ready') {
            if (this.allowedBuilds && !this.allowedBuilds.includes(m.build)) {
              const err = new Error(`build non pris en charge: ${m.build}`); err.fatal = true;
              sock.destroy(); return reject(err);
            }
            this.build = m.build; this.sock = sock; resolve();
          } else if (m.t === 'localPlayer' && [m.x, m.y, m.z, m.h].every(Number.isFinite)) {
            this.pos = { x: m.x, y: m.y, z: m.z, h: m.h };
          }
        }
      });
      sock.on('close', () => { this.sock = null; });
    });
  }

  #send(m) { this.sock?.write(JSON.stringify(m) + '\n'); }

  getLocalPlayerPosition() { return this.pos; }
  setRemotePlayer(id, name, pos) { this.#send({ t: 'setRemote', id, name, ...pos }); }
  removeRemotePlayer(id) { this.#send({ t: 'removeRemote', id }); }
  log(text) { this.logs.push(text); this.#send({ t: 'log', text }); console.log(`[game] ${text}`); }
  async shutdown() { this.sock?.end(); }
}
