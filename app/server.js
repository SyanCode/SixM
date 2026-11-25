import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryServer } from '../client/address.js';
import { linkSupported, pickPath, startLink } from '../client/link.js';
import { isExe, VictoryBuilder } from './builder.js';
import { Hosts, lanAddress } from './hosts.js';
import { findVictory, Launcher, resolveGame } from './launcher.js';
import { Session } from './session.js';
import { Settings } from './settings.js';
import { Updater } from './updater.js';
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
export async function createApp({ dataDir, port = 0, adapterOptions, builderOptions = {}, updaterOptions = {}, autoUpdate = false, onRestart = () => {}, onQuit = () => {} }) {
  const token = crypto.randomBytes(24).toString('base64url');
  const settings = new Settings(dataDir);
  const hosts = new Hosts(path.join(dataDir, 'servers'));
  const session = new Session({ adapterOptions });
  const linkDir = path.join(dataDir, 'link');
  let link = null;
  const launcher = new Launcher(path.join(dataDir, 'logs'), {
    profiles: path.join(dataDir, 'profiles'),
    onExit: (error) => { if (session.adapterName === 'victory') session.disconnect(error ?? 'le jeu est fermé'); },
  });
  const victory = new VictoryBuilder(path.join(dataDir, 'victory'), {
    logDir: path.join(dataDir, 'logs'), onInstalled: (exe) => settings.update({ victory: exe }), ...builderOptions,
  });
  const victoryValid = () => isExe(settings.value.victory);
  if (!victoryValid() && victory.supported) {
    const known = victory.installed();
    // Déjà compilé : on le reprend. Sinon on regarde seulement ce qui manque, rien n'est lancé.
    if (known) settings.update({ victory: known.exe });
    else victory.check().catch((e) => console.error('[victory]', e.message));
  }
  const quiet = () => session.status === 'idle' && !victory.busy && !launcher.pid
    && ![...hosts.running.values()].some((r) => ['starting', 'running', 'stopping'].includes(r.status));
  const updater = new Updater(dataDir, { canApply: quiet, onRestart, ...updaterOptions });
  /** Cherche puis applique ; VIctory est recompilé si SixM a changé son module. */
  const autoUpdateStep = async () => {
    if (!settings.value.autoUpdate) return;
    if (updater.status !== 'available') await updater.check();
    if (!await updater.apply() && quiet()) victory.autoRebuild();
  };
  const tryUpdate = () => autoUpdateStep().catch((e) => console.error('[update]', e.message));
  const updateTimer = autoUpdate ? setInterval(tryUpdate, 30 * 60000) : null;
  if (autoUpdate) tryUpdate();
  let lastSeen = Date.now();
  let origin;

  const selectedGame = () => settings.value.games.find((g) => g.id === settings.value.target);

  const ensureLink = async () => {
    if (!linkSupported || link) return;
    const started = await startLink({ port: adapterOptions?.port, dir: linkDir });
    if (started.external) return; // un autre bridge répond déjà
    link = started;
    started.exited.then(() => { if (link === started) link = null; });
  };

  /** Surcouche sur le jeu lancé ici, ou sur un VIctory ouvert à côté. */
  const attach = async () => session.setTarget(launcher.pid || await findVictory(settings.value.victory));

  /** Rejoint un serveur dans le mode choisi ; le jeu n'est lancé qu'une fois le serveur accepté. */
  const connect = async (address, password) => {
    const game = selectedGame();
    const victory = settings.value.target !== 'demo';
    if (session.status !== 'idle') throw new Error('déjà connecté à un serveur');
    if (game && !launcher.pid) { launcher.check(settings.value.victory, game); await launcher.prepare(); }
    if (victory) await ensureLink();
    session.connect({ address, password, name: settings.value.name, adapter: victory ? 'victory' : 'mock' })
      .then(async (ok) => {
        if (!ok) return;
        settings.remember(address);
        if (game && !launcher.pid) launcher.launch(settings.value.victory, game);
        if (game) session.useModule(launcher.bridge);
        if (victory) await attach();
      })
      .catch((e) => session.disconnect(e.message));
  };

  // VIctory ouvert à la main peut arriver ou repartir à tout moment.
  const attachTimer = setInterval(() => {
    if (session.status === 'connected' && session.adapterName === 'victory' && !launcher.pid) attach().catch(() => {});
  }, 3000);

  const routes = {
    'GET /api/state': async () => ({ settings: settings.value, session: session.state(), hosts: hosts.list(), lan: await lanAddress(), game: launcher.state(), linkSupported, victory: { ...victory.state(), valid: victoryValid() }, update: updater.state() }),
    'POST /api/settings': ({ name, target, victory, games, autoUpdate: auto }) => settings.update({
      ...(auto !== undefined && { autoUpdate: auto === true }),
      ...(name !== undefined && { name }), ...(target !== undefined && { target }),
      ...(victory !== undefined && { victory }), ...(games !== undefined && { games }),
    }),
    'POST /api/pick': async ({ title, folder }) => {
      if (!linkSupported) throw new Error('écrivez le chemin à la main');
      return { file: await pickPath(String(title ?? '').slice(0, 80) || 'Choisir', { folder: folder === true, dir: linkDir }) };
    },
    'POST /api/game/check': ({ path: target }) => ({ exe: resolveGame(target) }),
    'POST /api/update/check': async () => { await updater.check(); },
    'POST /api/update/apply': () => {
      if (!quiet()) throw new Error('quittez la partie et arrêtez vos serveurs d\'abord');
      updater.apply();
    },
    'POST /api/victory/rebuild': () => { victory.rebuild(); },
    'POST /api/profiles': () => { fs.mkdirSync(launcher.profiles, { recursive: true }); return openExternal(launcher.profiles); },
    'POST /api/game/launch': async () => {
      const game = selectedGame();
      if (!game) throw new Error('choisissez une installation du jeu');
      await launcher.prepare();
      launcher.launch(settings.value.victory, game);
    },
    'POST /api/game/stop': () => launcher.stop(),
    'POST /api/victory/check': async () => { await victory.check(); },
    'POST /api/victory/install': () => { victory.install(); },
    'POST /api/victory/update': () => { victory.update(); },
    'POST /api/victory/latest': async () => ({ commit: await victory.latest() }),
    'POST /api/victory/tool': ({ id }) => { victory.installTool(id); },
    'POST /api/victory/cancel': () => victory.cancel(),
    'POST /api/victory/storage': () => openExternal('ms-settings:storagesense'),
    'POST /api/favorite': ({ address, label }) => settings.toggleFavorite(String(address), label),
    'POST /api/query': async ({ address }) => {
      try { return { online: true, ...await queryServer(address) }; } catch { return { online: false }; }
    },
    'POST /api/connect': ({ address, password }) => {
      const target = String(address ?? '').trim();
      if (!target) throw new Error('entrez une adresse');
      return connect(target, password);
    },
    'POST /api/hosts/play': ({ id }) => {
      const { address, password } = hosts.joinInfo(id);
      return connect(address, password);
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
      lastSeen = Date.now();

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
    origin, token, settings, hosts, session, launcher,
    get link() { return link; },
    victory, updater,
    /** Rien en cours et plus aucune fenêtre ouverte depuis `ms`. */
    idleFor: (ms) => Date.now() - lastSeen > ms && quiet() && !updater.busy,
    url: `${origin}/#${token}`,
    close: async () => {
      clearInterval(attachTimer);
      clearInterval(updateTimer);
      await victory.close();
      await session.disconnect();
      await link?.stop();
      await hosts.stopAll();
      server.close();
      server.closeAllConnections();
    },
  };
}
