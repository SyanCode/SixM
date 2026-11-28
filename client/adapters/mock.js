import { GameAdapter } from '../adapter.js';

/**
 * Adaptateur sans jeu : pour tests, bots et développement de ressources. Il simule un jeu qui permet la
 * téléportation et deux valeurs, pour essayer les menus qui agissent sur le jeu.
 */
export class MockAdapter extends GameAdapter {
  remotes = new Map();
  logs = [];
  local = { x: 0, y: 0, z: 0, h: 0 };
  values = new Map(); // nom -> valeur
  scanner = true; // recherche mémoire simulée (une petite mémoire ci-dessous)
  profile = []; // lignes « enregistrées dans le profil »
  getAbilities() { return { teleport: true, values: [{ name: 'noclip', type: 'u8' }, { name: 'invincible', type: 'u8' }], scanner: this.scanner }; }

  /** Mémoire simulée : la position du joueur (trois f32), sa santé (i32), un indicateur (u8). */
  memory() {
    const base = 0x7ff600100000;
    return [
      { a: base, type: 'f32', v: this.local.x }, { a: base + 4, type: 'f32', v: this.local.y }, { a: base + 8, type: 'f32', v: this.local.z },
      { a: 0x200000040, type: 'i32', v: this.health ?? 200 }, { a: 0x200000044, type: 'i32', v: 200 }, { a: 0x200000048, type: 'u8', v: this.flag ?? 0 },
    ];
  }

  #scan(a) {
    const now = this.memory().filter((m) => m.type === a.type);
    const test = (m, old) => ({
      exact: a.type === 'f32' ? Math.abs(m.v - a.a) < 0.5 : m.v === a.a, between: m.v >= Math.min(a.a, a.b) && m.v <= Math.max(a.a, a.b),
      changed: m.v !== old, unchanged: m.v === old, increased: m.v > old, decreased: m.v < old,
    })[a.test];
    if (a.first) this.hits = now.filter((m) => test(m)).map((m) => ({ a: m.a, v: m.v }));
    else if (!this.hits || this.hitsType !== a.type) return this.onScan?.({ busy: false, type: a.type, count: 0, results: [], error: 'no search yet: start one with a value' });
    else this.hits = this.hits.map((h) => ({ h, m: now.find((m) => m.a === h.a) })).filter(({ h, m }) => m && test(m, h.v)).map(({ m }) => ({ a: m.a, v: m.v }));
    this.hitsType = a.type;
    this.onScan?.({ busy: false, type: a.type, count: this.hits.length, results: this.hits.slice(0, 30), error: null });
  }

  act(a) {
    if (['scan', 'poke', 'unpoke', 'pointers', 'saveProfile'].includes(a.action)) {
      queueMicrotask(() => {
        if (a.action === 'scan') return this.#scan(a);
        if (a.action === 'pointers') return this.onPointers?.({ address: a.address, chains: [[0x2a3f10, 0x18, a.address % 0x1000]] });
        if (a.action === 'poke') {
          const i = this.memory().findIndex((m) => m.a === a.address);
          if (i >= 0 && i < 3) this.local = { ...this.local, ['xyz'[i]]: a.value };
          if (i === 3) this.health = a.value;
          if (i === 5) this.flag = a.value;
        }
        if (a.action === 'saveProfile') this.profile.push(a);
        this.onResult?.({ what: a.action === 'saveProfile' ? 'profile' : a.action === 'unpoke' ? 'poke' : a.action, ok: true, error: null });
      });
      return true;
    }
    const known = a.action === 'teleport' || this.getAbilities().values.some((v) => v.name === a.name);
    if (known && a.action === 'teleport') this.local = { x: a.x, y: a.y, z: a.z, h: a.h ?? this.local.h };
    else if (known && a.action === 'set') this.values.set(a.name, a.value);
    queueMicrotask(() => this.onResult?.({ what: a.action === 'teleport' ? 'teleport' : a.name, ok: known, error: known ? null : 'the profile has no such value' }));
    return true;
  }
  async init() {}
  getLocalPlayerPosition() { return this.local; }
  setRemotePlayer(id, name, pos, avatar = null) { this.remotes.set(id, { name, pos, avatar }); }
  setModels(models) { this.models = models; }
  removeRemotePlayer(id) { this.remotes.delete(id); }
  log(text) { this.logs.push(text); console.log(`[game] ${text}`); }
}
