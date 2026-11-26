import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EventBus } from './core/events.js';
import { World } from './core/world.js';
import { ResourceManager } from './core/resources.js';
import { Network } from './core/network.js';
import { BanList } from './bans.js';
import { AccessList } from './access.js';
import { startAnnounce } from './announce.js';
import { MenuHub } from './menus.js';
import { loadConfig, normalizeConfig } from './config.js';
import { startConsole } from './console.js';

export async function createServer(rawConfig) {
  const config = normalizeConfig(rawConfig);
  const events = new EventBus();
  const world = new World();
  const bans = new BanList(config.bansFile);
  const access = new AccessList(config.accessFile);
  let net, menus;
  const player = (id) => world.players.get(id);
  const view = (p) => p && { id: p.id, name: p.name, uid: p.uid, admin: access.isAdmin(p.uid), pos: p.pos };

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
    chat: (id, text) => {
      const msg = { t: 'event', name: 'chat', args: [String(text).slice(0, 300)] };
      if (id === null || id === undefined) net.broadcast(msg); else net.sendToPlayer(id, msg);
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
  return {
    config, events, world, resources, net, bans, access, menus,
    stop: async () => {
      announce.stop();
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
