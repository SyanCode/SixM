// Démo de la surcouche en jeu, sans le jeu (Windows) : npm run overlay-demo
// SixM Link ouvre une fausse fenêtre de jeu ; un serveur local avec le mod « menu » tourne à côté.
// Dans la fenêtre : F7 ouvre le menu des mods (vous êtes admin), F8 écrit, F9 masque.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/index.js';
import { defaultLinkDir, linkSupported, startLink } from '../client/link.js';
import { SixMClient } from '../client/client.js';
import { VictoryAdapter } from '../client/adapters/victory.js';
import { MockAdapter } from '../client/adapters/mock.js';
import { createIdentity, playerUid } from '../server/identity.js';

if (!linkSupported) {
  console.log('[démo] la surcouche demande Windows.');
  process.exit(1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = await createServer({
  name: 'Démo SixM', port: 0, resourcesDir: path.join(root, 'resources'), autostart: ['hello', 'menu'],
  motd: 'Bienvenue sur la démo : F7 pour le menu.',
});
const url = `ws://localhost:${srv.net.port}`;
const me = createIdentity();
srv.access.setAdmin(playerUid(me.publicKey), 'Vous', true); // le menu Administration est visible

const link = await startLink({ port: 0, dir: defaultLinkDir(), demo: true });
const player = new SixMClient({ url, name: 'Vous', adapter: new VictoryAdapter({ port: link.port }), identity: me });
await player.connect();

// Deux joueurs de passage, pour la liste et le menu Administration.
const bots = [];
for (const name of ['Nina', 'Marco']) {
  const adapter = new MockAdapter();
  const c = new SixMClient({ url, name, adapter, identity: createIdentity() });
  await c.connect();
  let t = Math.random() * 6;
  bots.push(setInterval(() => { t += 0.05; adapter.local = { x: Math.cos(t) * 30, y: Math.sin(t) * 30, z: 0, h: t }; }, 50));
}
console.log('[démo] fenêtre ouverte : F7 menu, F8 écrire, F9 masquer. Ctrl+C pour quitter.');

const stop = async () => {
  for (const b of bots) clearInterval(b);
  await player.disconnect();
  await link.stop();
  await srv.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
link.exited?.then(stop);
