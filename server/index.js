import fs from 'node:fs';
import readline from 'node:readline';
import { EventBus } from './core/events.js';
import { World } from './core/world.js';
import { ResourceManager } from './core/resources.js';
import { Network } from './core/network.js';

export async function createServer(config) {
  const events = new EventBus();
  const world = new World();
  let net;

  // API exposée aux scripts serveur de chaque ressource (global `sixm`).
  const api = (resource) => ({
    on: (name, fn) => events.on(name, fn, resource),
    onNet: (name, fn) => events.on(`net:${name}`, fn, resource),
    emitClient: (playerId, name, ...args) => net.sendToPlayer(playerId, { t: 'event', name, args }),
    emitAllClients: (name, ...args) => net.broadcast({ t: 'event', name, args }),
    getPlayers: () => world.snapshot(),
    kick: (id, reason) => net.kick(id, reason),
  });

  const resources = new ResourceManager({ dir: config.resourcesDir, events, api });
  net = new Network({ port: config.port, world, events, config, resources });

  for (const r of config.autostart ?? []) resources.start(r);
  const port = await net.start();
  console.log(`[sixm] "${config.name}" en écoute sur ws://localhost:${port}`);
  return { events, world, resources, net, stop: () => net.stop() };
}

// Lancement direct : `npm start`
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = JSON.parse(fs.readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
  const srv = await createServer(config);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const [cmd, arg] = line.trim().split(/\s+/);
    try {
      if (cmd === 'start') srv.resources.start(arg);
      else if (cmd === 'stop') srv.resources.stop(arg);
      else if (cmd === 'restart') srv.resources.restart(arg);
      else if (cmd === 'players') console.table(srv.world.snapshot().map(({ id, name }) => ({ id, name })));
      else if (cmd === 'resources') console.log(srv.resources.list(), [...srv.resources.running.keys()]);
      else if (cmd === 'quit') process.exit(0);
      else if (cmd) console.log('commandes: start|stop|restart <res>, players, resources, quit');
    } catch (e) { console.error(e.message); }
  });
}
