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
    this.roster = null;
    this.menu = null; // menu ouvert, renvoyé au bridge après une reconnexion
    this.pid = 0;
    this.module = null;
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
            if (this.pid) this.#send({ t: 'target', pid: this.pid });
            if (this.roster) this.#send(this.roster);
            if (this.menu) this.#send({ t: 'menu', menu: this.menu });
            if (this.world) this.setWorld(this.world);
            for (const [id, r] of this.remotes) this.#send({ t: 'setRemote', id, name: r.name, ...r.pos });
            resolve();
          } else if (ready && m.t === 'localPlayer' && [m.x, m.y, m.z, m.h].every(Number.isFinite)) {
            this.pos = { x: m.x, y: m.y, z: m.z, h: m.h };
          } else if (ready && m.t === 'chat' && typeof m.text === 'string') {
            this.onChat?.(m.text);
          } else if (ready && m.t === 'menuOpen') {
            this.onMenuOpen?.();
          } else if (ready && m.t === 'menuClose') {
            this.menu = null;
            this.onMenuClose?.();
          } else if (ready && m.t === 'menuSelect' && typeof m.menu === 'string' && typeof m.item === 'string') {
            this.onMenuSelect?.(m.menu, m.item, m.value ?? null);
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
    if ((m.t === 'setRemote' || m.t === 'view') && this.sock?.writableLength > MAX_LINE) return;
    this.sock?.write(JSON.stringify(m) + '\n');
  }

  /** Module SixM dans VIctory : il connaît la position et la caméra, le bridge affiche. */
  useModule(module) {
    this.module = module;
    module.onCamera = (m) => {
      const p = module.position;
      this.#send({ t: 'view', m, ...(p && { x: p.x, y: p.y, z: p.z }) });
    };
  }

  getLocalPlayerPosition() { return this.module?.position ?? this.pos; }
  setRemotePlayer(id, name, pos) {
    this.remotes.set(id, { name, pos });
    this.#send({ t: 'setRemote', id, name, ...pos });
  }
  removeRemotePlayer(id) {
    this.remotes.delete(id);
    this.#send({ t: 'removeRemote', id });
  }
  setRoster(server, names) {
    this.roster = { t: 'roster', server, players: names };
    this.#send(this.roster);
  }
  /** Processus dont la fenêtre porte la surcouche ; 0 : aucun. */
  setTarget(pid) {
    if (pid === this.pid) return;
    this.pid = pid;
    this.#send({ t: 'target', pid });
  }
  /** Menu d'un mod, dessiné par la surcouche ; null le ferme. */
  setMenu(menu) {
    if (!menu && !this.menu) return;
    this.menu = menu;
    this.#send(menu ? { t: 'menu', menu } : { t: 'menuClose' });
  }
  /** Notification d'un mod, affichée par la surcouche. */
  notify(notice) { this.#send({ t: 'notify', ...notice }); }
  /** Heure et météo du serveur : affichées par la surcouche, appliquées par un portage qui sait le faire. */
  setWorld(world) {
    this.world = world;
    this.#send({ t: 'world', minutes: world.minutes, weather: world.weather, frozen: world.frozen });
  }
  log(text) { this.logs.push(text); this.#send({ t: 'log', text }); console.log(`[game] ${text}`); }
  async shutdown() { this.closing = true; this.module?.stop(); (this.sock ?? this.pending)?.end(); }
}
