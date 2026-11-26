import dgram from 'node:dgram';
import { LAN_PORT } from '../server/announce.js';

const TTL_MS = 15000;
const str = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, max);

/** Serveurs publics du réseau local : ils se signalent par diffusion UDP toutes les 5 s. */
export class Discovery {
  servers = new Map(); // adresse -> { address, name, seen }

  start() {
    try {
      this.sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.sock.on('error', () => this.stop());
      this.sock.on('message', (buf, rinfo) => {
        if (buf.length > 512 || this.servers.size > 200) return;
        let m;
        try { m = JSON.parse(buf); } catch { return; }
        if (m?.sixm !== 1 || !Number.isInteger(m.port) || m.port < 1 || m.port > 65535) return;
        const address = `${rinfo.address}:${m.port}`;
        this.servers.set(address, { address, name: str(m.name, 64), seen: Date.now() });
      });
      this.sock.bind(LAN_PORT);
    } catch { this.sock = null; }
  }

  list() {
    const now = Date.now();
    for (const [k, s] of this.servers) if (now - s.seen > TTL_MS) this.servers.delete(k);
    return [...this.servers.values()].map(({ address, name }) => ({ address, name }));
  }

  stop() {
    try { this.sock?.close(); } catch { /* déjà fermée */ }
    this.sock = null;
  }
}

/** Serveurs publics listés par les annuaires choisis dans les réglages. */
export async function fetchDirectories(urls) {
  const lists = await Promise.all(urls.map(async (base) => {
    try {
      const res = await fetch(new URL('/servers.json', base), { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!res.ok) return [];
      const list = await res.json();
      if (!Array.isArray(list)) return [];
      const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
      return list.slice(0, 500).filter((s) => typeof s?.address === 'string' && s.address.length < 100).map((s) => ({
        address: str(s.address, 100), name: str(s.name, 64) || 'Serveur SixM', description: str(s.description, 256),
        players: num(s.players), maxPlayers: num(s.maxPlayers), password: s.password === true, whitelist: s.whitelist === true,
        tags: Array.isArray(s.tags) ? s.tags.slice(0, 8).map((t) => str(t, 24)) : [], directory: base,
      }));
    } catch {
      return [];
    }
  }));
  const seen = new Map();
  for (const s of lists.flat()) if (!seen.has(s.address)) seen.set(s.address, s);
  return [...seen.values()];
}
