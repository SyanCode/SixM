import http from 'node:http';
import { queryServer } from '../client/address.js';

const TTL_MS = 3 * 60000;
const MAX_SERVERS = 2000;
const MAX_PER_IP = 10;

/**
 * Annuaire de serveurs publics : un serveur s'y inscrit (POST /announce { port }), l'annuaire lit sa
 * fiche à l'adresse d'où vient la demande et ne garde que les serveurs publics qui répondent.
 * GET /servers.json : la liste, pour l'onglet « Publics » de SixM.
 */
export async function startDirectory({ port = 30100, host = undefined, trustProxy = false } = {}) {
  const servers = new Map(); // adresse -> { address, info, seen }
  const fresh = () => {
    const now = Date.now();
    for (const [k, s] of servers) if (now - s.seen > TTL_MS) servers.delete(k);
    return [...servers.values()];
  };
  const ipOf = (req) => {
    const fwd = trustProxy && req.headers['x-forwarded-for']?.split(',').at(-1).trim();
    return (fwd || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  };

  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === 'GET' && req.url === '/servers.json') {
        return reply(200, fresh().map(({ address, info }) => ({ address, ...info })));
      }
      if (req.method !== 'POST' || req.url !== '/announce') return reply(404, { error: 'introuvable' });
      let text = '';
      for await (const c of req) { text += c; if (text.length > 1024) return reply(413, { error: 'trop long' }); }
      const p = JSON.parse(text || '{}').port;
      if (!Number.isInteger(p) || p < 1 || p > 65535) return reply(400, { error: 'port invalide' });
      const ip = ipOf(req);
      const address = ip.includes(':') ? `[${ip}]:${p}` : `${ip}:${p}`;
      if (!servers.has(address)) {
        fresh();
        if (servers.size >= MAX_SERVERS) return reply(503, { error: 'annuaire plein' });
        if ([...servers.values()].filter((s) => s.ip === ip).length >= MAX_PER_IP) return reply(429, { error: 'trop de serveurs pour cette adresse' });
      }
      // Vérification : la fiche doit répondre depuis cette adresse et se dire publique.
      const info = await queryServer(address, { timeoutMs: 4000 }).catch(() => null);
      if (!info) return reply(422, { error: 'serveur injoignable depuis l\'annuaire : ouvrez le port' });
      if (info.visibility === 'private') { servers.delete(address); return reply(403, { error: 'serveur privé' }); }
      servers.set(address, { address, ip, info: { ...info, ping: undefined }, seen: Date.now() });
      reply(200, { ok: true, address });
    } catch {
      reply(400, { error: 'requête invalide' });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { port: server.address().port, servers, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
}
