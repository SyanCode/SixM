import fs from 'node:fs';

/** Bannissements par IP et par identifiant de joueur. Fichier : [{ ip, uid?, name, reason, at }], `at` en ISO 8601. */
export class BanList {
  constructor(file = null) {
    this.file = file;
    this.bans = new Map();
    if (!file || !fs.existsSync(file)) return;
    // Un fichier illisible doit arrêter le serveur, pas lever tous les bannissements.
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(list)) throw new Error(`${file} : liste attendue`);
    for (const b of list) if (typeof b?.ip === 'string') this.bans.set(b.ip, b);
  }

  /** Bannissement qui touche cette IP ou cet identifiant. */
  get(ip, uid = null) {
    return this.bans.get(ip) ?? (uid ? this.list().find((b) => b.uid === uid) : undefined);
  }
  list() { return [...this.bans.values()]; }

  add(ip, name, reason, uid = null) {
    this.bans.set(ip, { ip, ...(uid && { uid }), name, reason, at: new Date().toISOString() });
    this.#save();
  }

  remove(ip) {
    const found = this.bans.delete(ip);
    if (found) this.#save();
    return found;
  }

  #save() {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.list(), null, 2) + '\n');
    fs.renameSync(tmp, this.file);
  }
}
