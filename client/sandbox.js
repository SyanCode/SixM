import { newQuickJSWASMModule } from 'quickjs-emscripten';

const LIMITS = {
  memoryBytes: 16 << 20, // par ressource
  stackBytes: 512 << 10,
  loadMs: 2000,
  eventMs: 100,
  resources: 64,
  sourceBytes: 4 << 20,
  callsPerSecond: 100, // log + emitServer, toutes ressources confondues
};

// Exécuté dans QuickJS : construit `sixm` à partir de deux fonctions qui ne prennent que des chaînes.
const BOOTSTRAP = `((emit, log) => {
  const handlers = new Map();
  const parse = JSON.parse, stringify = JSON.stringify;
  const show = (a) => a.map((v) => typeof v === 'string' ? v : String(stringify(v))).join(' ');
  globalThis.sixm = Object.freeze({
    on(name, fn) {
      if (typeof fn !== 'function') throw new TypeError('sixm.on: fonction attendue');
      const list = handlers.get(String(name));
      if (list) list.push(fn); else handlers.set(String(name), [fn]);
    },
    emitServer(name, ...args) { emit(String(name), stringify(args)); },
    log(text) { log(String(text)); },
  });
  globalThis.console = Object.freeze({
    log: (...a) => log(show(a)), warn: (...a) => log(show(a)), error: (...a) => log(show(a)),
  });
  return (name, json) => {
    const args = parse(json);
    for (const fn of handlers.get(name) ?? []) {
      try { fn(...args); } catch (e) { log('erreur: ' + e); }
    }
  };
})`;

/**
 * Exécute les scripts client reçus d'un serveur, donc du code NON FIABLE.
 *
 * Chaque ressource tourne dans son propre runtime QuickJS compilé en WebAssembly : aucun objet de
 * Node n'y entre, seules des chaînes traversent la frontière. Pas de fichiers, de réseau, de process.
 * `node:vm` ne convient pas ici : `sixm.on.constructor('return process')()` suffit à en sortir.
 */
export class ScriptSandbox {
  static async create(options) {
    // Module WASM propre à ce client : une corruption éventuelle y reste confinée.
    return new ScriptSandbox(await newQuickJSWASMModule(), options);
  }

  constructor(quickjs, { onEmit, onLog, limits = {} }) {
    this.quickjs = quickjs;
    this.onEmit = onEmit;
    this.onLog = onLog;
    this.limits = { ...LIMITS, ...limits };
    this.resources = new Map(); // nom -> { runtime, ctx, dispatch }
    this.deadline = 0;
    this.calls = { start: -Infinity, n: 0 }; // la première fenêtre commence au premier appel
  }

  /** bundle : [{ name, files: [{ file, source }] }] tel que reçu du serveur. */
  load(bundle) {
    if (!Array.isArray(bundle) || bundle.length > this.limits.resources) throw new Error('ressources invalides');
    let bytes = 0;
    for (const res of bundle) {
      if (typeof res?.name !== 'string' || !Array.isArray(res.files)) throw new Error('ressources invalides');
      for (const f of res.files) {
        if (typeof f?.file !== 'string' || typeof f.source !== 'string') throw new Error('ressources invalides');
        bytes += Buffer.byteLength(f.source);
      }
    }
    if (bytes > this.limits.sourceBytes) throw new Error('scripts client trop volumineux');
    for (const res of bundle) this.#loadOne(res);
  }

  dispatch(event, args) {
    const json = JSON.stringify(args);
    for (const [name, res] of this.resources) {
      this.#guard(name, this.limits.eventMs, () => {
        const { ctx } = res;
        const a = ctx.newString(event);
        const b = ctx.newString(json);
        try {
          this.#unwrap(res, ctx.callFunction(res.dispatch, ctx.undefined, a, b));
        } finally {
          a.dispose();
          b.dispose();
        }
      });
    }
  }

  dispose() {
    for (const name of [...this.resources.keys()]) this.#drop(name);
  }

  #loadOne({ name, files }) {
    if (this.resources.has(name)) throw new Error('ressource en double');
    const runtime = this.quickjs.newRuntime();
    runtime.setMemoryLimit(this.limits.memoryBytes);
    runtime.setMaxStackSize(this.limits.stackBytes);
    runtime.setInterruptHandler(() => performance.now() > this.deadline);
    const ctx = runtime.newContext();
    const res = { runtime, ctx, dispatch: null };
    this.resources.set(name, res);

    this.#guard(name, this.limits.loadMs, () => {
      const emit = ctx.newFunction('emit', (n, json) => {
        const event = ctx.getString(n);
        const text = ctx.getString(json);
        if (this.#allowCall()) this.onEmit(event, JSON.parse(text));
      });
      const log = ctx.newFunction('log', (t) => {
        const text = ctx.getString(t);
        if (this.#allowCall()) this.onLog(text);
      });
      const boot = ctx.unwrapResult(ctx.evalCode(BOOTSTRAP, 'sixm'));
      res.dispatch = ctx.unwrapResult(ctx.callFunction(boot, ctx.undefined, emit, log));
      for (const h of [boot, emit, log]) h.dispose();
      for (const f of files) this.#unwrap(res, ctx.evalCode(f.source, `${name}/${f.file}`));
    });
  }

  /** Libère le résultat, exécute les promesses en attente, lève une Error Node si le script a échoué. */
  #unwrap({ runtime, ctx }, result) {
    this.#check(ctx, result);
    // Par lots : QuickJS transforme une interruption survenue dans une promesse en simple rejet.
    while (runtime.hasPendingJob()) {
      this.#check(ctx, runtime.executePendingJobs(100));
      if (performance.now() > this.deadline) throw new Error('temps dépassé');
    }
  }

  #check(ctx, result) {
    if (!result.error) return result.value?.dispose?.();
    const handle = result.error;
    const context = handle.context ?? ctx;
    try {
      const prop = (k) => {
        const h = context.getProp(handle, k);
        try { return context.typeof(h) === 'string' ? context.getString(h) : ''; } finally { h.dispose(); }
      };
      throw new Error(context.typeof(handle) === 'object' ? `${prop('name')}: ${prop('message')}` : 'erreur de script');
    } finally {
      handle.dispose();
    }
  }

  /** Toute erreur (exception, temps, mémoire) désactive la ressource fautive, jamais le client. */
  #guard(name, ms, fn) {
    this.deadline = performance.now() + ms;
    try {
      fn();
    } catch (e) {
      this.#drop(name);
      this.onLog(`ressource "${name}" désactivée (${e?.message ?? e})`);
    }
  }

  #drop(name) {
    const res = this.resources.get(name);
    this.resources.delete(name);
    try {
      res.dispatch?.dispose();
      res.ctx.dispose();
      res.runtime.dispose();
    } catch {
      // Runtime interrompu en plein calcul : sa mémoire part avec le module WASM du client.
    }
  }

  #allowCall() {
    const now = performance.now();
    if (now - this.calls.start > 1000) this.calls = { start: now, n: 0 };
    return ++this.calls.n <= this.limits.callsPerSecond;
  }
}
