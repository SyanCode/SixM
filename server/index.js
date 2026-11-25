import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EventBus } from './core/events.js';
import { World } from './core/world.js';
import { ResourceManager } from './core/resources.js';
import { Network } from './core/network.js';
import { BanList } from './bans.js';
import { loadConfig, normalizeConfig } from './config.js';
import { startConsole } from './console.js';

export async function createServer(rawConfig) {
  const config = normalizeConfig(rawConfig);
  const events = new EventBus();
  const world = new World();
  const bans = new BanList(config.bansFile);
  let net;

  // API exposée aux scripts serveur de chaque ressource (global `sixm`).
  const api = (resource) => ({
    on: (name, fn) => events.on(name, fn, resource),
    onNet: (name, fn) => events.on(`net:${name}`, fn, resource),
    emitClient: (playerId, name, ...args) => net.sendToPlayer(playerId, { t: 'event', name, args }),
    emitAllClients: (name, ...args) => net.broadcast({ t: 'event', name, args }),
    getPlayers: () => world.snapshot(),
    kick: (id, reason) => net.kick(id, reason),
    ban: (id, reason) => net.ban(id, reason),
  });

  const resources = new ResourceManager({ dir: config.resourcesDir, events, api });
  net = new Network({ port: config.port, world, events, config, resources, bans });

  // "*" : tous les mods déposés dans le dossier des ressources.
  const autostart = config.autostart.includes('*') ? resources.list() : config.autostart;
  for (const r of autostart) {
    // Une ressource cassée ne doit pas empêcher le serveur de démarrer.
    try { resources.start(r); } catch (e) { console.error(`[resources] échec de "${r}" : ${e.message}`); }
  }
  const port = await net.start();
  console.log(`[sixm] "${config.name}" en écoute sur ws://localhost:${port}${config.password ? ' (mot de passe)' : ''}`);
  return {
    config, events, world, resources, net, bans,
    stop: async () => {
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
