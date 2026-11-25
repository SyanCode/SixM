import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryServer } from '../client/address.js';
import { Hosts, lanAddress } from './hosts.js';
import { Session } from './session.js';
import { Settings } from './settings.js';
import { openExternal } from './window.js';

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');
const STATIC = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};
const HEADERS = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};
const JSON_LIMIT = 64 << 10;
const ZIP_LIMIT = 25 << 20;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Interface locale de SixM, sur 127.0.0.1 uniquement. Elle peut lancer des serveurs et écrire des
 * fichiers : chaque appel exige le jeton de la session et un en-tête Host exact, pour qu'aucun site
 * web ouvert dans le navigateur ne puisse la piloter (CSRF, DNS rebinding).
 */
export async function createApp({ dataDir, port = 0, adapterOptions, onQuit = () => {} }) {
  const token = crypto.randomBytes(24).toString('base64url');
  const settings = new Settings(dataDir);
  const hosts = new Hosts(path.join(dataDir, 'servers'));
  const session = new Session({ adapterOptions });
  let origin;

  const connect = (address, password) => {
    session.connect({ address, password, name: settings.value.name, adapter: settings.value.adapter })
      .then(() => { if (session.status === 'connected') settings.remember(address); })
      .catch((e) => console.error('[app]', e));
  };

  const routes = {
    'GET /api/state': async () => ({ settings: settings.value, session: session.state(), hosts: hosts.list(), lan: await lanAddress() }),
    'POST /api/settings': ({ name, adapter }) => settings.update({
      ...(name !== undefined && { name }), ...(adapter !== undefined && { adapter }),
    }),
    'POST /api/favorite': ({ address, label }) => settings.toggleFavorite(String(address), label),
    'POST /api/query': async ({ address }) => {
      try { return { online: true, ...await queryServer(address) }; } catch { return { online: false }; }
    },
    'POST /api/connect': ({ address, password }) => {
      const target = String(address ?? '').trim();
      if (!target) throw new Error('entrez une adresse');
      connect(target, password);
    },
    'POST /api/hosts/play': ({ id }) => {
      const { address, password } = hosts.joinInfo(id);
      connect(address, password);
    },
    'POST /api/disconnect': () => session.disconnect(),
    'POST /api/chat': ({ text }) => session.chat(text),
    'POST /api/hosts': (body) => ({ id: hosts.create(body) }),
    'POST /api/hosts/update': ({ id, ...patch }) => hosts.update(id, patch),
    'POST /api/hosts/start': ({ id }) => hosts.start(id),
    'POST /api/hosts/stop': ({ id }) => hosts.stop(id),
    'POST /api/hosts/command': ({ id, line }) => hosts.command(id, line),
    'POST /api/hosts/mod': ({ id, name, enabled }) => hosts.setMod(id, name, enabled === true),
    'POST /api/hosts/open': ({ id }) => openExternal(path.join(hosts.path(id), 'resources')),
    'POST /api/quit': () => { setTimeout(onQuit, 100); },
  };

  const sameToken = (given) => {
    const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
    return crypto.timingSafeEqual(hash(given), hash(token));
  };

  const readBody = async (req, limit) => {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new HttpError(413, 'fichier trop volumineux');
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  };

  const handle = async (req, res) => {
    const reply = (status, type, body) => { res.writeHead(status, { ...HEADERS, 'content-type': type }); res.end(body); };
    const json = (status, value) => reply(status, 'application/json; charset=utf-8', JSON.stringify(value ?? {}));
    try {
      if (`http://${req.headers.host}` !== origin) throw new HttpError(403, 'hôte refusé');
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && Object.hasOwn(STATIC, url.pathname)) {
        const [file, type] = STATIC[url.pathname];
        return reply(200, `${type}; charset=utf-8`, fs.readFileSync(path.join(UI, file)));
      }
      if (req.headers.origin !== undefined && req.headers.origin !== origin) throw new HttpError(403, 'origine refusée');
      if (!sameToken(req.headers['x-sixm-token'] ?? '')) throw new HttpError(401, 'session expirée, rouvrez SixM');

      const key = `${req.method} ${url.pathname}`;
      if (key === 'POST /api/hosts/import') {
        const zip = await readBody(req, ZIP_LIMIT);
        return json(200, hosts.importMod(url.searchParams.get('id'), zip, url.searchParams.get('file') ?? ''));
      }
      if (!Object.hasOwn(routes, key) && key !== 'POST /api/pack') throw new HttpError(404, 'introuvable');
      let body = {};
      if (req.method === 'POST') {
        const text = (await readBody(req, JSON_LIMIT)).toString('utf8');
        try { body = text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'requête invalide'); }
        if (!body || typeof body !== 'object') throw new HttpError(400, 'requête invalide');
      }
      if (key === 'POST /api/pack') return reply(200, 'application/zip', hosts.pack(body.id));
      json(200, await routes[key](body));
    } catch (e) {
      json(e.status ?? 400, { error: e.message });
    }
  };

  const server = http.createServer(handle);
  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(port, '127.0.0.1', res);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, token, settings, hosts, session,
    url: `${origin}/#${token}`,
    close: async () => {
      await session.disconnect();
      await hosts.stopAll();
      server.close();
      server.closeAllConnections();
    },
  };
}
