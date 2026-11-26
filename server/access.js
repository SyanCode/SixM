import fs from 'node:fs';
import { UID } from './identity.js';

const MAX = 1000;
const MAX_REQUESTS = 50;
const clean = (s, max = 24) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, max);
const entry = (e) => (UID.test(e?.uid) ? { uid: e.uid, name: clean(e.name), at: typeof e.at === 'string' ? e.at.slice(0, 30) : '' } : null);

/**
 * Accès au serveur, par identifiant de joueur : liste blanche, demandes en attente, administrateurs.
 * Fichier access.json, relu avant chaque modification : l'application peut l'éditer pendant que le
 * serveur tourne (puis « access reload »).
 */
export class AccessList {
  constructor(file = null) {
    this.file = file;
    this.data = { whitelist: [], requests: [], admins: [] };
    this.reload();
  }

  static parse(raw) {
    const list = (v, max) => (Array.isArray(v) ? v : []).map(entry).filter(Boolean).slice(0, max);
    return { whitelist: list(raw?.whitelist, MAX), requests: list(raw?.requests, MAX_REQUESTS), admins: list(raw?.admins, MAX) };
  }

  reload() {
    if (!this.file || !fs.existsSync(this.file)) return;
    // Fichier illisible : on s'arrête plutôt que d'ouvrir le serveur à tout le monde.
    this.data = AccessList.parse(JSON.parse(fs.readFileSync(this.file, 'utf8')));
  }

  isAdmin(uid) { return !!uid && this.data.admins.some((e) => e.uid === uid); }
  allowed(uid) { return !!uid && (this.isAdmin(uid) || this.data.whitelist.some((e) => e.uid === uid)); }

  /** Un joueur absent de la liste blanche a frappé : l'hôte peut l'accepter. Renvoie true si nouveau. */
  request(uid, name) {
    return this.#change((d) => {
      if (d.requests.some((e) => e.uid === uid)) return false;
      d.requests.unshift({ uid, name: clean(name), at: new Date().toISOString() });
      d.requests.length = Math.min(d.requests.length, MAX_REQUESTS);
      return true;
    });
  }

  add(uid, name = '') {
    if (!UID.test(uid)) throw new Error(`identifiant invalide : ${uid}`);
    return this.#change((d) => {
      const known = d.requests.find((e) => e.uid === uid);
      d.requests = d.requests.filter((e) => e.uid !== uid);
      if (!d.whitelist.some((e) => e.uid === uid)) d.whitelist.push({ uid, name: clean(name || known?.name), at: new Date().toISOString() });
    });
  }

  remove(uid) { return this.#change((d) => { d.whitelist = d.whitelist.filter((e) => e.uid !== uid); }); }
  deny(uid) { return this.#change((d) => { d.requests = d.requests.filter((e) => e.uid !== uid); }); }

  setAdmin(uid, name, on) {
    if (!UID.test(uid)) throw new Error(`identifiant invalide : ${uid}`);
    return this.#change((d) => {
      d.admins = d.admins.filter((e) => e.uid !== uid);
      // Un admin passe la liste blanche : sa demande n'a plus lieu d'être.
      if (on) d.requests = d.requests.filter((e) => e.uid !== uid);
      if (on) d.admins.push({ uid, name: clean(name), at: new Date().toISOString() });
    });
  }

  #change(fn) {
    this.reload();
    const result = fn(this.data);
    if (this.file) {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n');
      fs.renameSync(tmp, this.file);
    }
    return result;
  }
}
