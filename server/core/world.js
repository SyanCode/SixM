// État du monde : joueurs connectés et leur position synchronisée.
export class World {
  players = new Map(); // id -> { id, name, pos:{x,y,z,h}, socket }
  #nextId = 1;

  addPlayer(name, socket, ip = '', uid = null) {
    const p = { id: this.#nextId++, name, uid, pos: { x: 0, y: 0, z: 0, h: 0 }, located: false, socket, ip };
    this.players.set(p.id, p);
    return p;
  }
  setPosition(player, pos) { player.pos = pos; player.located = true; }
  removePlayer(id) { this.players.delete(id); }

  /**
   * Ce qu'un joueur voit. Un joueur sans position connue n'apparaît chez personne.
   * radius > 0 : seulement les joueurs à cette distance (en unités du jeu).
   */
  snapshotFor(viewer, radius = 0) {
    const out = [];
    for (const { id, name, pos, located } of this.players.values()) {
      if (!located) continue;
      if (radius > 0 && viewer.located && id !== viewer.id
        && Math.hypot(pos.x - viewer.pos.x, pos.y - viewer.pos.y, pos.z - viewer.pos.z) > radius) continue;
      out.push({ id, name, pos });
    }
    return out;
  }

  snapshot() {
    return [...this.players.values()].map(({ id, name, uid, pos }) => ({ id, name, uid, pos }));
  }
}
