import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/**
 * Gestionnaire de ressources (équivalent des "resources" FiveM).
 * Chaque ressource = un dossier avec resource.json :
 *   { "name": "hello", "server": ["server.js"], "client": ["client.js"] }
 * Les scripts serveur s'exécutent dans un contexte vm isolé avec une API restreinte.
 * NB : vm n'est PAS une frontière de sécurité face à du code hostile ; n'exécutez
 * que des ressources de confiance (voir docs/ARCHITECTURE.md).
 */
export class ResourceManager {
  running = new Map();

  constructor({ dir, events, api }) {
    this.dir = path.resolve(dir);
    this.events = events;
    this.api = api;
  }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter((n) =>
      fs.existsSync(path.join(this.dir, n, 'resource.json')));
  }

  start(name) {
    if (this.running.has(name)) throw new Error(`ressource déjà démarrée: ${name}`);
    const root = path.join(this.dir, name);
    // Empêche la traversée de chemin via le nom
    if (path.dirname(root) !== this.dir) throw new Error('nom de ressource invalide');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'resource.json'), 'utf8'));

    const timers = new Set();
    const track = (id) => { timers.add(id); return id; };
    const sandbox = {
      console: { log: (...a) => console.log(`[${name}]`, ...a), error: (...a) => console.error(`[${name}]`, ...a) },
      // Suivis pour être coupés à l'arrêt de la ressource.
      setTimeout: (fn, ms, ...a) => {
        const id = track(setTimeout(() => { timers.delete(id); fn(...a); }, ms));
        return id;
      },
      setInterval: (fn, ms, ...a) => track(setInterval(fn, ms, ...a)),
      clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
      clearInterval: (id) => { timers.delete(id); clearInterval(id); },
      sixm: this.api(name),
    };
    const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });

    const read = (file) => {
      const full = path.resolve(root, file);
      if (!full.startsWith(root + path.sep)) throw new Error(`chemin hors ressource: ${file}`);
      return { full, source: fs.readFileSync(full, 'utf8') };
    };
    let clientFiles;
    try {
      clientFiles = (manifest.client ?? []).map((f) => ({ file: f, source: read(f).source }));
      for (const file of manifest.server ?? []) {
        const { full, source } = read(file);
        new vm.Script(source, { filename: full }).runInContext(ctx, { timeout: 2000 });
      }
    } catch (e) {
      // Démarrage raté : ne laisser ni handlers ni timers derrière.
      this.events.removeOwner(name);
      for (const id of timers) clearTimeout(id);
      throw e;
    }
    this.running.set(name, { manifest, clientFiles, timers });
    this.events.emit('resourceStart', name);
    console.log(`[resources] démarrée: ${name}`);
  }

  stop(name) {
    const res = this.running.get(name);
    if (!res) return false;
    this.running.delete(name);
    for (const id of res.timers) clearTimeout(id);
    res.timers.clear();
    this.events.removeOwner(name);
    this.events.emit('resourceStop', name);
    return true;
  }

  restart(name) { this.stop(name); this.start(name); }

  /** Scripts client à envoyer aux joueurs à la connexion. */
  clientBundle() {
    return [...this.running].map(([name, r]) => ({ name, files: r.clientFiles }));
  }
}
