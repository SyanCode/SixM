import fs from 'node:fs';

/** Bannissements par IP. Fichier : [{ ip, name, reason, at }], `at` en ISO 8601. */
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

  get(ip) { return this.bans.get(ip); }
  list() { return [...this.bans.values()]; }

  add(ip, name, reason) {
    this.bans.set(ip, { ip, name, reason, at: new Date().toISOString() });
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
