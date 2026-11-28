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
  getAbilities() { return { teleport: true, values: [{ name: 'noclip', type: 'u8' }, { name: 'invincible', type: 'u8' }] }; }
  act(a) {
    const known = a.action === 'teleport' || this.getAbilities().values.some((v) => v.name === a.name);
    if (known && a.action === 'teleport') this.local = { x: a.x, y: a.y, z: a.z, h: a.h ?? this.local.h };
    else if (known && a.action === 'set') this.values.set(a.name, a.value);
    queueMicrotask(() => this.onResult?.({ what: a.action === 'teleport' ? 'teleport' : a.name, ok: known, error: known ? null : 'the profile has no such value' }));
    return true;
  }
  async init() {}
  getLocalPlayerPosition() { return this.local; }
  setRemotePlayer(id, name, pos) { this.remotes.set(id, { name, pos }); }
  removeRemotePlayer(id) { this.remotes.delete(id); }
  log(text) { this.logs.push(text); console.log(`[game] ${text}`); }
}
