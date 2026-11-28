import WebSocket from 'ws';
import { PositionBuffer } from './interpolation.js';
import { ScriptSandbox } from './sandbox.js';
import { signChallenge } from '../server/identity.js';
import { cleanMenu, cleanNotice, cleanValue, cleanWorld } from '../server/menus.js';
import { cleanAbilities, cleanAction, cleanResult } from '../server/game.js';

const samePos = (a, b) => a && a.x === b.x && a.y === b.y && a.z === b.z && a.h === b.h;
const isPos = (p) => p && [p.x, p.y, p.z, p.h].every(Number.isFinite);
// Texte venu du serveur : sans caractères de contrôle (séquences de terminal) et borné.
const clean = (text, max = 500) => String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, max);

/** Client SixM : connexion, sync de position, exécution isolée des scripts client des ressources. */
export class SixMClient {
  constructor({
    url, name, adapter, password, identity = null, posIntervalMs = 50, renderIntervalMs = 33,
    interpolationDelayMs = 100, connectTimeoutMs = 10000, onDisconnect = null,
  }) {
    Object.assign(this, {
      url, name, adapter, password, identity, posIntervalMs, renderIntervalMs,
      interpolationDelayMs, connectTimeoutMs, onDisconnect,
    });
    this.id = null;
    this.players = []; // avec position connue
    this.roster = []; // tous
    this.remotes = new Map(); // id -> { name, buffer, applied }
    this.kickReason = null;
    this.uid = null; // identifiant vérifié par le serveur
    this.menu = null; // menu ouvert par le serveur
    this.menuSeq = 0;
    this.notices = []; // notifications récentes : { seq, at, ...notice }
    this.noticeSeq = 0;
    this.world = null; // { minutes, weather, frozen, at } : heure reçue et moment de réception
  }

  async connect() {
    await this.adapter.init();
    try {
      this.sandbox = await ScriptSandbox.create({
        onEmit: (name, args) => this.emitServer(name, ...args),
        onLog: (text) => this.adapter.log(clean(text)),
      });
      this.adapter.onChat = (text) => this.emitServer('chat', clean(text, 200));
      // Menus pilotés depuis le jeu (surcouche) : mêmes messages que depuis la fenêtre de SixM.
      this.adapter.onMenuOpen = () => this.openMenu();
      this.adapter.onMenuClose = () => this.closeMenu();
      this.adapter.onMenuSelect = (menu, item, value) => this.selectMenu(clean(menu, 48), clean(item, 48), value);
      this.adapter.onResult = (r) => this.#send({ t: 'gameResult', ...cleanResult(r) });
      await this.#handshake();
    } catch (e) {
      this.ws?.terminate();
      this.sandbox?.dispose();
      await this.adapter.shutdown();
      throw e;
    }
    this.posTimer = setInterval(() => {
      const pos = this.adapter.getLocalPlayerPosition();
      // null : le jeu n'a pas (ou plus) de position à donner, ex. bridge déconnecté.
      if (pos) this.#send({ t: 'pos', x: pos.x, y: pos.y, z: pos.z, h: pos.h });
      // Ce que le jeu permet change avec le profil et le module : le serveur l'apprend à chaque changement.
      const can = cleanAbilities(this.adapter.getAbilities?.());
      const key = JSON.stringify(can);
      if (key !== this.abilitiesSent) { this.abilitiesSent = key; this.#send({ t: 'game', ...can }); }
    }, this.posIntervalMs);
    this.renderTimer = setInterval(() => this.#render(), this.renderIntervalMs);
  }

  #handshake() {
    return new Promise((resolve, reject) => {
      let welcomed = false;
      const ws = this.ws = new WebSocket(this.url, { maxPayload: 16 << 20 });
      const timer = setTimeout(() => reject(new Error('délai de connexion dépassé')), this.connectTimeoutMs);
      const fail = (e) => { clearTimeout(timer); reject(e); };
      // Le serveur commence par un défi ; un serveur plus ancien n'en envoie pas.
      let said = false, fallback;
      const hello = (nonce) => {
        if (said) return;
        said = true;
        clearTimeout(fallback);
        const m = { t: 'hello', name: this.name, password: this.password };
        if (nonce && this.identity) Object.assign(m, { key: this.identity.publicKey, sig: signChallenge(this.identity, nonce) });
        this.#send(m);
      };
      ws.on('open', () => { fallback = setTimeout(() => hello(null), 1500); });
      ws.on('error', fail);
      ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw); } catch { return; }
        if (!m || typeof m !== 'object') return;
        if (m.t === 'challenge') return hello(typeof m.nonce === 'string' ? m.nonce.slice(0, 64) : null);
        try {
          this.#onMessage(m);
        } catch (e) {
          if (welcomed) console.error('[client] message ignoré:', e);
          else fail(e);
          return;
        }
        if (m.t === 'welcome') {
          welcomed = true;
          clearTimeout(timer);
          resolve();
        }
      });
      ws.on('close', () => {
        clearTimeout(fallback);
        if (!welcomed) return fail(new Error(this.kickReason ?? 'connexion refusée par le serveur'));
        this.#stop();
        this.onDisconnect?.(this.kickReason);
      });
    });
  }

  emitServer(name, ...args) { this.#send({ t: 'event', name, args }); }

  /** Touche Menu : le serveur répond par son menu principal. */
  openMenu() { this.#send({ t: 'menuOpen' }); }
  /** Choix dans un menu : bouton validé, case cochée, liste ou curseur changé. */
  selectMenu(menu, item, value = null) { this.#send({ t: 'menu', menu: String(menu), item: String(item), value: cleanValue(value) }); }
  closeMenu() {
    this.menu = null;
    this.menuSeq++;
    this.adapter.setMenu?.(null);
  }

  async disconnect() {
    this.onDisconnect = null;
    this.#stop();
    this.ws?.close();
    await this.adapter.shutdown();
  }

  /** Arrête la synchro et retire les avatars distants. */
  #stop() {
    clearInterval(this.posTimer);
    clearInterval(this.renderTimer);
    for (const id of this.remotes.keys()) this.adapter.removeRemotePlayer(id);
    this.remotes.clear();
    this.players = [];
    this.menu = null;
    this.sandbox?.dispose();
  }

  #setWorld(w) {
    if (!w || typeof w !== 'object') return;
    this.world = { ...cleanWorld(w), at: Date.now() };
    this.adapter.setWorld?.(this.world);
  }

  /** Heure du monde maintenant (le serveur avance d'une minute toutes les 2 s). */
  worldNow() {
    if (!this.world) return null;
    const { minutes, weather, frozen, at } = this.world;
    const now = frozen ? minutes : (minutes + Math.floor((Date.now() - at) / 2000)) % 1440;
    return { minutes: now, weather, frozen };
  }

  #send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  #render() {
    const time = performance.now() - this.interpolationDelayMs;
    for (const [id, r] of this.remotes) {
      const pos = r.buffer.sample(time);
      if (!pos || samePos(r.applied, pos)) continue;
      r.applied = pos;
      this.adapter.setRemotePlayer(id, r.name, pos);
    }
  }

  #onMessage(m) {
    if (m.t === 'welcome') {
      if (this.id !== null) return; // un seul accueil par connexion
      if (!Number.isSafeInteger(m.id)) throw new Error('accueil invalide');
      this.id = m.id;
      this.serverName = clean(m.server ?? '', 64);
      this.uid = typeof m.uid === 'string' ? clean(m.uid, 40) : null;
      this.sandbox.load(m.resources);
      if (typeof m.motd === 'string' && m.motd.trim()) this.adapter.log(clean(m.motd, 256));
      if (m.world) this.#setWorld(m.world);
    } else if (m.t === 'snapshot') {
      if (!Array.isArray(m.players)) return;
      const now = performance.now();
      const seen = new Set();
      for (const p of m.players) {
        if (!Number.isSafeInteger(p?.id) || p.id === this.id || !isPos(p.pos)) continue;
        seen.add(p.id);
        let r = this.remotes.get(p.id);
        if (!r) this.remotes.set(p.id, r = { name: clean(p.name, 24), buffer: new PositionBuffer(), applied: null });
        r.buffer.push(now, p.pos);
      }
      for (const id of this.remotes.keys()) {
        if (seen.has(id)) continue;
        this.remotes.delete(id);
        this.adapter.removeRemotePlayer(id);
      }
      this.players = m.players.filter((p) => Number.isSafeInteger(p?.id) && isPos(p.pos))
        .map((p) => ({ id: p.id, name: clean(p.name, 24), pos: p.pos }));
    } else if (m.t === 'roster') {
      if (!Array.isArray(m.players)) return;
      this.roster = m.players.slice(0, 1024).filter((p) => Number.isSafeInteger(p?.id))
        .map((p) => ({ id: p.id, name: clean(p.name, 24), admin: p.admin === true }));
      this.adapter.setRoster(this.serverName, this.roster.map((p) => p.name));
    } else if (m.t === 'event') {
      if (typeof m.name === 'string' && Array.isArray(m.args)) this.sandbox.dispatch(m.name, m.args);
    } else if (m.t === 'menu') {
      try { this.menu = cleanMenu(m.menu); } catch { return; }
      this.menuSeq++;
      this.adapter.setMenu?.(this.menu);
    } else if (m.t === 'menuClose') {
      this.closeMenu();
    } else if (m.t === 'notify') {
      let notice;
      try { notice = cleanNotice(m.notice); } catch { return; }
      this.notices.push({ seq: ++this.noticeSeq, at: Date.now(), ...notice });
      if (this.notices.length > 20) this.notices.shift();
      this.adapter.notify?.(notice);
    } else if (m.t === 'world') {
      this.#setWorld(m.world);
    } else if (m.t === 'gameAct') {
      // Seulement ce que le jeu a annoncé ; le module le vérifie encore avec le profil.
      let a;
      try { a = cleanAction(m.action); } catch { return; }
      const can = cleanAbilities(this.adapter.getAbilities?.());
      const allowed = a.action === 'teleport' ? can.teleport : can.values.some((v) => v.name === a.name);
      if (!allowed || !this.adapter.act?.(a)) this.#send({ t: 'gameResult', what: a.action === 'teleport' ? 'teleport' : a.name, ok: false, error: 'non permis par ce jeu' });
    } else if (m.t === 'kick') {
      this.kickReason = clean(m.reason);
      this.adapter.log(`Déconnecté: ${this.kickReason}`);
    }
  }
}
