// État du monde : joueurs connectés et leur position synchronisée.
export class World {
  players = new Map(); // id -> { id, name, pos:{x,y,z,h}, socket }
  #nextId = 1;

  addPlayer(name, socket) {
    const p = { id: this.#nextId++, name, pos: { x: 0, y: 0, z: 0, h: 0 }, socket };
    this.players.set(p.id, p);
    return p;
  }
  removePlayer(id) { this.players.delete(id); }

  snapshot() {
    return [...this.players.values()].map(({ id, name, pos }) => ({ id, name, pos }));
  }
}
