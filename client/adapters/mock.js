import { GameAdapter } from '../adapter.js';

/** Adaptateur sans jeu : pour tests, bots et développement de ressources. */
export class MockAdapter extends GameAdapter {
  remotes = new Map();
  logs = [];
  local = { x: 0, y: 0, z: 0, h: 0 };
  async init() {}
  getLocalPlayerPosition() { return this.local; }
  setRemotePlayer(id, name, pos) { this.remotes.set(id, { name, pos }); }
  removeRemotePlayer(id) { this.remotes.delete(id); }
  log(text) { this.logs.push(text); console.log(`[game] ${text}`); }
}
