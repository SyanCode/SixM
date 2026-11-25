// Bus d'évènements minimal, utilisé en interne et exposé aux ressources.
export class EventBus {
  #handlers = new Map();

  on(name, fn, owner = null) {
    if (!this.#handlers.has(name)) this.#handlers.set(name, new Set());
    const entry = { fn, owner };
    this.#handlers.get(name).add(entry);
    return () => this.#handlers.get(name)?.delete(entry);
  }

  /** Retire tous les handlers d'une ressource (arrêt/redémarrage). */
  removeOwner(owner) {
    for (const set of this.#handlers.values())
      for (const e of [...set]) if (e.owner === owner) set.delete(e);
  }

  emit(name, ...args) {
    const set = this.#handlers.get(name);
    if (!set) return;
    for (const { fn } of [...set]) {
      try { Promise.resolve(fn(...args)).catch((err) => console.error(`[events] erreur dans "${name}":`, err)); }
      catch (err) { console.error(`[events] erreur dans "${name}":`, err); }
    }
  }
}
