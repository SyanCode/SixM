import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { DEFAULT_MODEL, defaultModel, MAX_MODELS, parseObj } from '../avatars.js';

const BUILT_IN = { [DEFAULT_MODEL]: defaultModel() };

/**
 * Gestionnaire de ressources (équivalent des "resources" FiveM).
 * Chaque ressource = un dossier avec resource.json :
 *   { "name": "hello", "server": ["server.js"], "client": ["client.js"], "models": ["models/robot.obj"] }
 * `models` : avatars 3D (Wavefront OBJ, voir server/avatars.js), nommés d'après leur fichier ou `{ name, file }`.
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
    let clientFiles, models = {};
    try {
      clientFiles = (manifest.client ?? []).map((f) => ({ file: f, source: read(f).source }));
      for (const m of (Array.isArray(manifest.models) ? manifest.models : []).slice(0, MAX_MODELS)) {
        const file = typeof m === 'string' ? m : m?.file;
        const label = (typeof m === 'object' && m?.name) || path.basename(String(file), path.extname(String(file)));
        if (!/^[\w.-]{1,32}$/.test(label)) throw new Error(`nom de modèle invalide : ${label}`);
        try { models[label] = parseObj(read(file).source); } catch (e) { throw new Error(`modèle ${file} : ${e.message}`); }
      }
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
    this.running.set(name, { manifest, clientFiles, timers, models });
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

  /** Avatars 3D des ressources démarrées, et celui par défaut. */
  models() {
    const out = { ...BUILT_IN };
    for (const r of this.running.values()) for (const [n, m] of Object.entries(r.models)) if (Object.keys(out).length < MAX_MODELS) out[n] = m;
    return out;
  }

  /** Scripts client à envoyer aux joueurs à la connexion. */
  clientBundle() {
    return [...this.running].map(([name, r]) => ({ name, files: r.clientFiles }));
  }
}
