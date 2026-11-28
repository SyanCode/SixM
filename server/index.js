import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EventBus } from './core/events.js';
import { World } from './core/world.js';
import { ResourceManager } from './core/resources.js';
import { Network } from './core/network.js';
import { BanList } from './bans.js';
import { AccessList } from './access.js';
import { startAnnounce } from './announce.js';
import { MenuHub, cleanNotice, cleanWorld } from './menus.js';

// Une minute du monde toutes les deux secondes : une journée en 48 minutes, comme dans les jeux de ce genre.
const WORLD_SECONDS_PER_MINUTE = 2;
import { loadConfig, normalizeConfig } from './config.js';
import { cleanAction, NO_ABILITIES } from './game.js';
import { startConsole } from './console.js';
import { UID } from './identity.js';

export async function createServer(rawConfig) {
  const config = normalizeConfig(rawConfig);
  const events = new EventBus();
  const world = new World();
  const bans = new BanList(config.bansFile);
  const access = new AccessList(config.accessFile);
  let net, menus;
  const player = (id) => world.players.get(id);
  const view = (p) => p && { id: p.id, name: p.name, uid: p.uid, admin: access.isAdmin(p.uid), pos: p.pos, located: p.located, game: p.game ?? NO_ABILITIES };
  /** Action sur le jeu d'un joueur, seulement si son jeu l'a annoncée (le module la vérifie encore). */
  const act = (id, action) => {
    const p = player(id), a = cleanAction(action);
    const can = p?.game ?? NO_ABILITIES;
    if (!p || !(a.action === 'teleport' ? can.teleport : can.values.some((v) => v.name === a.name))) return false;
    net.sendToPlayer(id, { t: 'gameAct', action: a });
    return true;
  };

  // API exposée aux scripts serveur de chaque ressource (global `sixm`).
  const api = (resource) => ({
    on: (name, fn) => events.on(name, fn, resource),
    onNet: (name, fn) => events.on(`net:${name}`, fn, resource),
    emitClient: (playerId, name, ...args) => net.sendToPlayer(playerId, { t: 'event', name, args }),
    emitAllClients: (name, ...args) => net.broadcast({ t: 'event', name, args }),
    getPlayers: () => [...world.players.values()].map(view),
    getPlayer: (id) => view(player(id)) ?? null,
    kick: (id, reason) => net.kick(id, reason),
    ban: (id, reason) => net.ban(id, reason),
    isAdmin: (id) => net.isAdmin(id),
    setAdmin: (id, on) => {
      const p = player(id);
      if (!p?.uid) throw new Error('joueur sans identité');
      access.setAdmin(p.uid, p.name, on !== false);
      net.sendRoster();
    },
    whitelist: {
      enabled: () => config.whitelist,
      add: (uid, name) => access.add(uid, name),
      remove: (uid) => access.remove(uid),
      requests: () => access.data.requests.map((e) => ({ ...e })),
    },
    // Notification en haut de l'écran du joueur (id) ou de tous (null).
    notify: (id, notice) => {
      const msg = { t: 'notify', notice: cleanNotice(notice) };
      if (id === null || id === undefined) net.broadcast(msg); else net.sendToPlayer(id, msg);
    },
    // Heure (minutes depuis minuit) et météo partagées par tous les joueurs.
    getWorld: () => ({ ...world.state }),
    setWorld: (patch) => {
      world.state = cleanWorld(patch, world.state);
      net.broadcast({ t: 'world', world: world.state });
      return { ...world.state };
    },
    chat: (id, text) => {
      const msg = { t: 'event', name: 'chat', args: [String(text).slice(0, 300)] };
      if (id === null || id === undefined) net.broadcast(msg); else net.sendToPlayer(id, msg);
    },
    // Ressources du serveur. Une ressource ne peut pas s'arrêter elle-même depuis son propre code.
    resources: {
      list: () => resources.list().map((name) => ({ name, running: resources.running.has(name) })),
      start: (name) => resources.start(String(name)),
      stop: (name) => { if (name === resource) throw new Error('une ressource ne s\'arrête pas elle-même'); return resources.stop(String(name)); },
      restart: (name) => { if (name === resource) throw new Error('une ressource ne se redémarre pas elle-même'); resources.restart(String(name)); },
    },
    // Jeu de chaque joueur, par le module SixM dans VIctory : ce que son profil local permet.
    // Renvoient faux si son jeu ne le permet pas ; le résultat arrive par l'évènement 'gameResult'.
    game: {
      abilities: (id) => structuredClone(player(id)?.game ?? NO_ABILITIES),
      teleport: (id, pos) => act(id, { action: 'teleport', ...pos }),
      set: (id, name, value, { hold = false } = {}) => act(id, { action: 'set', name, value, hold }),
      release: (id, name) => act(id, { action: 'release', name }),
    },
    // Menus : entrée du menu principal, ouverture et choix.
    addMenu: (entry) => menus.add(resource, entry),
    openMenu: (id, menu) => { const p = player(id); if (p) menus.open(p, menu); },
    closeMenu: (id) => { const p = player(id); if (p) menus.close(p); },
    onMenu: (menuId, fn) => events.on(`menu:${menuId}`, fn, resource),
  });

  const resources = new ResourceManager({ dir: config.resourcesDir, events, api });
  net = new Network({ port: config.port, world, events, config, resources, bans, access });
  menus = net.menus = new MenuHub({ net, events, config });
  events.on('resourceStop', (name) => menus.removeOwner(name));
  events.on('playerDropped', (p) => menus.forget(p));

  // "*" : tous les mods déposés dans le dossier des ressources.
  const autostart = config.autostart.includes('*') ? resources.list() : config.autostart;
  for (const r of autostart) {
    // Une ressource cassée ne doit pas empêcher le serveur de démarrer.
    try { resources.start(r); } catch (e) { console.error(`[resources] échec de "${r}" : ${e.message}`); }
  }
  const port = await net.start();
  const extra = [config.password && 'mot de passe', config.whitelist && 'liste blanche', config.visibility === 'private' && 'privé'].filter(Boolean);
  console.log(`[sixm] "${config.name}" en écoute sur ws://localhost:${port}${extra.length ? ` (${extra.join(', ')})` : ''}`);
  const announce = startAnnounce({ config, port });
  const clock = setInterval(() => {
    if (world.state.frozen) return;
    world.state = { ...world.state, minutes: (world.state.minutes + 1) % 1440 };
    // Les clients avancent l'heure eux-mêmes ; un rappel par heure du monde corrige les écarts.
    if (world.state.minutes % 60 === 0) net.broadcast({ t: 'world', world: world.state });
  }, WORLD_SECONDS_PER_MINUTE * 1000);
  clock.unref();
  return {
    config, events, world, resources, net, bans, access, menus,
    stop: async () => {
      announce.stop();
      clearInterval(clock);
      for (const r of [...resources.running.keys()]) resources.stop(r);
      await net.stop();
    },
  };
}

/** Lance un serveur depuis un dossier contenant server.json, avec console et arrêt propre. */
export async function hostDirectory(dir) {
  const config = loadConfig(dir);
  const srv = await createServer(config).catch((e) => {
    throw e.code === 'EADDRINUSE' ? new Error(`le port ${config.port} est déjà utilisé`) : e;
  });
  // SIXM_ADMINS : administrateurs donnés par l'hébergeur, sans console ni application.
  for (const uid of (process.env.SIXM_ADMINS ?? '').split(/[\s,;]+/).filter(Boolean)) {
    if (!UID.test(uid)) { console.error(`[sixm] SIXM_ADMINS : identifiant ignoré, ${uid.slice(0, 40)}`); continue; }
    if (!srv.access.isAdmin(uid)) srv.access.setAdmin(uid, '', true);
  }
  let stopping = false;
  srv.shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await srv.stop();
    process.exit(0);
  };
  process.on('SIGINT', srv.shutdown);
  process.on('SIGTERM', srv.shutdown);
  startConsole(srv);
  // Lancé par l'application : état lisible par elle (joueurs, demandes d'accès), sur une ligne à part.
  if (process.env.SIXM_PARENT) {
    const status = () => console.log(`@sixm ${JSON.stringify({
      players: [...srv.world.players.values()].map((p) => ({ id: p.id, name: p.name, uid: p.uid, admin: srv.access.isAdmin(p.uid) })),
    })}`);
    srv.events.on('rosterChanged', status);
    srv.events.on('accessRequest', (r) => console.log(`[accès] demande de ${r.name} (${r.uid})`));
    status();
  }
  return srv;
}

// Lancement direct : `npm start`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await hostDirectory(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  } catch (e) {
    console.error(`[sixm] ${e.message}`);
    process.exit(1);
  }
}
