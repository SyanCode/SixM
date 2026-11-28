import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryServer } from '../client/address.js';
import { linkSupported, pickPath, startLink } from '../client/link.js';
import { isExe, VictoryBuilder } from './builder.js';
import { Hosts, lanAddress } from './hosts.js';
import { Discovery, fetchDirectories } from './discovery.js';
import { cleanOptions, customPort, findOptions, isRepo, portArgs, portEnv, PORTS } from './ports.js';
import { findSdk, searchRoots } from './sdks.js';
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
export async function createApp({ dataDir, port = 0, adapterOptions, builderOptions = {}, updaterOptions = {}, sdkFinder = findSdk, sdkRoots = searchRoots(), autoUpdate = false, onRestart = () => {}, onQuit = () => {} }) {
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
  // Portages : un dossier et une compilation par projet ; un seul compile à la fois.
  const ports = () => [...PORTS, customPort(settings.value.customPort)];
  const portOf = (id) => ports().find((p) => p.id === id) ?? PORTS[0];
  const builders = new Map(); // clé : id (et dépôt pour « au choix ») -> VictoryBuilder
  const builder = (id) => {
    const port = portOf(id);
    const key = port.custom ? `custom ${port.repo} ${port.pinned}` : port.id;
    if (!builders.has(key)) {
      builders.set(key, new VictoryBuilder(port.id === 'victory' ? path.join(dataDir, 'victory') : path.join(dataDir, 'ports', port.id), {
        name: port.name, repo: port.repo, pinned: port.pinned, logDir: path.join(dataDir, 'logs'),
        // Installé : devient le programme lancé, si ce portage est toujours celui choisi.
        onInstalled: (exe) => { if (settings.value.port === port.id) settings.update({ victory: exe }); },
        ...builderOptions,
      }));
    }
    return builders.get(key);
  };
  const current = () => builder(settings.value.port);
  const anyBusy = () => [...builders.values()].some((b) => b.busy);
  const startBuild = (fn) => {
    if (anyBusy()) throw new Error('une installation est déjà en cours');
    if (settings.value.port === 'custom' && !isRepo(portOf('custom').repo)) throw new Error('indiquez d\'abord le dépôt du portage');
    fn(current());
  };
  const victoryValid = () => isExe(settings.value.victory);
  /** Dossiers DLSS et FidelityFX trouvés pour un portage ; relus au plus toutes les 20 s pour l'interface. */
  const foundCache = new Map();
  const found = (id, fresh = false) => {
    const port = portOf(id), hit = foundCache.get(port.id);
    if (!fresh && hit && Date.now() - hit.at < 20000) return hit.value;
    const b = port.custom && !isRepo(port.repo) ? null : builder(port.id), exe = b?.installed()?.exe;
    const ctx = { exeDir: exe ? path.dirname(exe) : null, src: b?.src ?? null, localAppData: process.env.LOCALAPPDATA ?? null, roots: sdkRoots };
    const value = findOptions(port, ctx, sdkFinder);
    foundCache.set(port.id, { at: Date.now(), value });
    return value;
  };
  const launchEnv = () => ({
    ...portEnv(portOf(settings.value.port), settings.value.portOptions[settings.value.port], found(settings.value.port, true)),
    ...(settings.value.scanner && { SIXM_SCANNER: '1' }), // lu par le module SixM au lancement du jeu
  });
  const launchArgs = (exe, console) => portArgs(portOf(settings.value.port), settings.value.portOptions[settings.value.port], exe, console);
  const victory = current();
  if (!victoryValid() && victory.supported) {
    const known = victory.installed();
    // Déjà compilé : on le reprend. Sinon on regarde seulement ce qui manque, rien n'est lancé.
    if (known) settings.update({ victory: known.exe });
    else victory.check().catch((e) => console.error('[victory]', e.message));
  }
  const quiet = () => session.status === 'idle' && !anyBusy() && !launcher.pid
    && ![...hosts.running.values()].some((r) => ['starting', 'running', 'stopping'].includes(r.status));
  const updater = new Updater(dataDir, { canApply: quiet, onRestart, ...updaterOptions });
  /** Cherche puis applique ; VIctory est recompilé si SixM a changé son module. */
  const autoUpdateStep = async () => {
    if (!settings.value.autoUpdate) return;
    if (updater.status !== 'available') await updater.check();
    if (!await updater.apply() && quiet()) current().autoRebuild();
  };
  const tryUpdate = () => autoUpdateStep().catch((e) => console.error('[update]', e.message));
  const updateTimer = autoUpdate ? setInterval(tryUpdate, 30 * 60000) : null;
  if (autoUpdate) tryUpdate();
  let lastSeen = Date.now();
  let origin;

  const discovery = new Discovery();
  discovery.start();
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
    session.connect({ address, password, name: settings.value.name, identity: settings.value.identity, adapter: victory ? 'victory' : 'mock' })
      .then(async (ok) => {
        if (!ok) return;
        settings.remember(address);
        if (game && !launcher.pid) launcher.launch(settings.value.victory, game, launchEnv(), launchArgs);
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
    'GET /api/state': async () => ({ settings: settings.public(), discovered: discovery.list(), session: session.state(), hosts: hosts.list(), lan: await lanAddress(), game: launcher.state(), linkSupported, victory: { ...current().state(), valid: victoryValid() }, update: updater.state(),
      ports: ports().map((p) => {
        const b = p.custom && !isRepo(p.repo) ? null : builder(p.id);
        return {
          id: p.id, name: p.name, author: p.author, url: p.url, repo: p.repo, description: p.description, tags: p.tags, custom: !!p.custom,
          pinned: p.pinned, options: p.options.map(({ on, off, env, find, ...o }) => o), values: cleanOptions(p, settings.value.portOptions[p.id]),
          found: found(p.id), fetch: Object.keys(p.fetch ?? {}),
          installed: b?.installed() ?? null, status: b?.status ?? 'idle',
        };
      }),
    }),
    'POST /api/ports/select': ({ id }) => {
      if (!ports().some((p) => p.id === id)) throw new Error('portage inconnu');
      // Le programme lancé suit le portage choisi : le sien s'il est installé.
      const exe = isRepo(portOf(id).repo) ? builder(id).installed()?.exe ?? '' : '';
      settings.update({ port: id, victory: exe });
      return settings.public();
    },
    'POST /api/ports/options': ({ id, values }) => {
      const port = ports().find((p) => p.id === id);
      if (!port) throw new Error('portage inconnu');
      settings.update({ portOptions: { ...settings.value.portOptions, [id]: cleanOptions(port, values) } });
    },
    'POST /api/ports/custom': ({ repo = '', commit = '' }) => {
      const r = String(repo).trim().replace(/\/+$/, ''), c = String(commit).trim().toLowerCase();
      if (r && !isRepo(r)) throw new Error('adresse attendue : https://github.com/propriétaire/dépôt');
      if (c && !/^[0-9a-f]{40}$/.test(c)) throw new Error('commit attendu : 40 caractères hexadécimaux, ou rien pour le dernier');
      settings.update({ customPort: { repo: r, commit: c } });
    },
    'POST /api/settings': ({ name, target, victory, games, directories, autoUpdate: auto, scanner }) => {
      settings.update({
        ...(auto !== undefined && { autoUpdate: auto === true }),
        ...(scanner !== undefined && { scanner: scanner === true }),
        ...(name !== undefined && { name }), ...(target !== undefined && { target }),
        ...(victory !== undefined && { victory }), ...(games !== undefined && { games }),
        ...(directories !== undefined && { directories }),
      });
      return settings.public();
    },
    'POST /api/directories': async () => ({ servers: await fetchDirectories(settings.value.directories) }),
    'POST /api/menu/open': () => session.openMenu(),
    'POST /api/menu/close': () => session.closeMenu(),
    'POST /api/menu/select': ({ menu, item, value }) => session.selectMenu(menu, item, value),
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
    'POST /api/victory/rebuild': ({ force }) => {
      if (force && launcher.pid) throw new Error('arrêtez d\'abord le jeu : son programme va être remplacé');
      startBuild((b) => b.rebuild({ force: force === true }));
    },
    /** Le portage télécharge lui-même une bibliothèque (ex. DLSS depuis le GitHub de NVIDIA). */
    'POST /api/ports/fetch': ({ kind }) => {
      const args = portOf(settings.value.port).fetch?.[kind];
      if (!Array.isArray(args)) throw new Error('ce portage ne sait pas télécharger cela');
      startBuild((b) => b.fetch(args, kind === 'streamline' ? 'Téléchargement des fichiers DLSS de NVIDIA' : 'Téléchargement'));
    },
    'POST /api/profiles': () => { fs.mkdirSync(launcher.profiles, { recursive: true }); return openExternal(launcher.profiles); },
    'POST /api/game/launch': async () => {
      const game = selectedGame();
      if (!game) throw new Error('choisissez une installation du jeu');
      await launcher.prepare();
      launcher.launch(settings.value.victory, game, launchEnv(), launchArgs);
    },
    'POST /api/game/stop': () => launcher.stop(),
    'GET /api/victory/log': () => ({ text: current().report() }),
    'POST /api/victory/check': async () => { await current().check(); },
    'POST /api/victory/install': () => startBuild((b) => b.install()),
    'POST /api/victory/update': () => startBuild((b) => b.update()),
    'POST /api/victory/latest': async () => ({ commit: await current().latest() }),
    'POST /api/victory/tool': ({ id }) => startBuild((b) => b.installTool(id)),
    'POST /api/victory/cancel': () => { for (const b of builders.values()) b.cancel(); },
    'POST /api/victory/storage': () => openExternal('ms-settings:storagesense'),
    'POST /api/favorite': ({ address, label }) => { settings.toggleFavorite(String(address), label); return settings.public(); },
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
    'POST /api/hosts/access': ({ id, action, uid, name }) => hosts.access(id, String(action), String(uid ?? ''), String(name ?? '')),
    'POST /api/hosts/player': ({ id, player, action }) => hosts.playerAction(id, Number(player), String(action)),
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
    get victory() { return current(); }, updater,
    /** Rien en cours et plus aucune fenêtre ouverte depuis `ms`. */
    idleFor: (ms) => Date.now() - lastSeen > ms && quiet() && !updater.busy,
    url: `${origin}/#${token}`,
    close: async () => {
      clearInterval(attachTimer);
      discovery.stop();
      clearInterval(updateTimer);
      await Promise.all([...builders.values()].map((b) => b.close()));
      await session.disconnect();
      await link?.stop();
      await hosts.stopAll();
      server.close();
      server.closeAllConnections();
    },
  };
}
