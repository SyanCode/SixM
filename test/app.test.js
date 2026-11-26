import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createApp } from '../app/server.js';
import { createZip, isSafePath, readZip } from '../app/zip.js';
import { importMod, listMods } from '../app/mods.js';
import { packServer } from '../app/pack.js';
import { Settings } from '../app/settings.js';
import { createServer } from '../server/index.js';
import { startSimBridge } from '../integrations/victory/sim-bridge.js';
import { SixMClient } from '../client/client.js';
import { MockAdapter } from '../client/adapters/mock.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-'));
const until = async (cond, what, ms = 6000) => {
  const end = Date.now() + ms;
  while (!await cond()) {
    if (Date.now() > end) assert.fail(`délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};
const freePort = () => new Promise((res) => {
  const s = http.createServer().listen(0, () => { const { port } = s.address(); s.close(() => res(port)); });
});
const mod = (name, extra = {}, prefix = `${name}/`) => createZip([
  { name: `${prefix}resource.json`, data: JSON.stringify({ name, server: ['s.js'], client: ['c.js'], ...extra }) },
  { name: `${prefix}s.js`, data: 'sixm.on("playerConnected", (p) => sixm.emitClient(p.id, "salut", p.name));' },
  { name: `${prefix}c.js`, data: 'sixm.on("salut", (n) => sixm.log("bienvenue " + n));' },
]);

async function withApp(fn, options = {}) {
  const dataDir = tmp();
  const app = await createApp({ dataDir, ...options });
  const raw = (p, init = {}) => fetch(app.origin + p, { ...init, headers: { 'x-sixm-token': app.token, ...init.headers } });
  const post = async (p, body = {}) => {
    const res = await raw(p, { method: 'POST', body: body instanceof Buffer ? body : JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    return json;
  };
  const state = async () => (await raw('/api/state')).json();
  try { await fn({ app, raw, post, state, dataDir }); } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

test('zip : aller-retour, accents, fichier vide', () => {
  const big = Buffer.alloc(100000, 'abc');
  const zip = createZip([{ name: 'é/a.txt', data: 'salut' }, { name: 'vide', data: '' }, { name: 'gros', data: big, mode: 0o755 }]);
  assert.ok(zip.length < 2000, 'compressé');
  const out = readZip(zip);
  assert.deepEqual(out.map((f) => f.name), ['é/a.txt', 'vide', 'gros']);
  assert.equal(out[0].data.toString(), 'salut');
  assert.ok(out[2].data.equals(big));
});

test('zip hostile : chemins, bombes, corruption', () => {
  for (const bad of ['../x', '/x', 'a/../../x', 'C:/x', 'a/con', 'NUL.txt', 'f:flux', 'a./b', 'a//b', './a', ''])
    assert.equal(isSafePath(bad), false, bad);
  for (const bad of ['../x', '..\\x', '/abs', 'C:\\x'])
    assert.throws(() => readZip(createZip([{ name: bad, data: 'x' }])), /chemin refusé/, bad);
  assert.throws(() => readZip(createZip([{ name: 'a', data: Buffer.alloc(2000) }]), { maxBytes: 1000 }), /volumineux/);
  assert.throws(() => readZip(createZip([{ name: 'a', data: '' }, { name: 'b', data: '' }]), { maxEntries: 1 }), /trop de fichiers/);
  assert.throws(() => readZip(Buffer.from('pas un zip du tout, vraiment')), /pas un zip/);
  assert.throws(() => readZip(Buffer.alloc(0)), /zip/);

  // Taille annoncée mensongère : la décompression réelle doit être bornée.
  const bomb = createZip([{ name: 'a', data: Buffer.alloc(1 << 20) }]);
  const central = bomb.indexOf(Buffer.from('PK\x01\x02', 'latin1'));
  bomb.writeUInt32LE(10, central + 24);
  assert.throws(() => readZip(bomb), /abîmé/);

  const flipped = createZip([{ name: 'a', data: 'contenu' }]);
  flipped[32] ^= 0xff;
  assert.throws(() => readZip(flipped), /abîmé/);
  const good = mod('m');
  for (let cut = 0; cut < good.length; cut += 7) assert.throws(() => readZip(good.subarray(0, cut)), /zip/);
});

test('mods : import, dossier ou racine, refus', () => {
  const dir = path.join(tmp(), 'resources');
  assert.deepEqual(importMod(dir, mod('un')), { name: 'un' });
  assert.deepEqual(importMod(dir, mod('deux', {}, '')), { name: 'deux' });
  assert.deepEqual(importMod(dir, mod('x', { name: undefined, description: 'd' }, ''), 'trois.zip'), { name: 'trois' });
  assert.deepEqual(listMods(dir).map((m) => m.name), ['deux', 'trois', 'un']);
  assert.throws(() => importMod(dir, mod('un')), /déjà installé/);
  assert.throws(() => importMod(dir, mod('../evil', {}, '')), /nom de mod invalide/);
  assert.throws(() => importMod(dir, mod('con', {}, '')), /nom de mod invalide/);
  assert.throws(() => importMod(dir, mod('m', { server: ['absent.js'] })), /fichier manquant/);
  assert.throws(() => importMod(dir, mod('m', { server: 'x' })), /liste/);
  assert.throws(() => importMod(dir, createZip([{ name: 'a.txt', data: '' }])), /resource.json/);
  assert.throws(() => importMod(dir, createZip([{ name: 'resource.json', data: '{' }])), /JSON/);
  assert.deepEqual(fs.readdirSync(path.dirname(dir)), ['resources'], 'aucun reste d\'import');
});

test('réglages : valeurs nettoyées, fichier illisible toléré', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), '{cassé');
  const s = new Settings(dir);
  assert.equal(s.value.name, 'Joueur');
  s.update({ name: ' Zoé\u0007 ', target: 'inconnu', games: [{ name: '', path: 'C:\\a', console: 'x' }] });
  for (let i = 0; i < 20; i++) s.remember(`h${i}`);
  s.remember('h19');
  s.toggleFavorite('a', 'A'); s.toggleFavorite('b', 'B'); s.toggleFavorite('a');
  const again = new Settings(dir).value;
  assert.deepEqual([again.name, again.target, again.recents.length, again.recents[0]], ['Zoé', 'demo', 8, 'h19']);
  assert.deepEqual([again.games[0].name, again.games[0].console], ['Mon jeu', 'series-x']);
  assert.match(again.games[0].id, /^[a-f0-9]{8}$/);
  assert.equal(s.update({ target: again.games[0].id }).target, again.games[0].id);
  assert.equal(s.update({ games: [] }).target, 'demo', 'installation retirée : retour à la démo');
  assert.deepEqual(again.favorites, [{ address: 'b', label: 'B' }]);
});

test('API : jeton, hôte, origine, routes', async () => withApp(async ({ app, raw }) => {
  assert.equal((await fetch(`${app.origin}/api/state`)).status, 401);
  assert.equal((await raw('/api/state', { headers: { 'x-sixm-token': 'x' } })).status, 401);
  assert.equal((await raw('/api/state', { headers: { origin: 'https://mal.example' } })).status, 403);
  assert.equal((await raw('/api/state', { headers: { origin: 'null' } })).status, 403);
  // DNS rebinding : même adresse, autre nom d'hôte.
  const rebound = await new Promise((res) => http.get(app.origin, { headers: { host: 'mal.example' } }, (r) => { r.resume(); res(r.statusCode); }));
  assert.equal(rebound, 403);
  assert.equal((await raw('/api/state')).status, 200);
  assert.equal((await raw('/api/constructor')).status, 404);
  assert.equal((await raw('/../package.json')).status, 404);
  assert.equal((await raw('/api/chat', { method: 'POST', body: 'null' })).status, 400);
  assert.equal((await raw('/api/chat', { method: 'POST', body: 'x'.repeat(70000) })).status, 413);
  const page = await fetch(app.origin);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.ok(!(await page.text()).includes(app.token), 'le jeton n\'est pas dans la page');
  assert.equal(new URL(app.origin).hostname, '127.0.0.1');
}));

test('jouer : connexion, chat, joueurs, mot de passe, déconnexion', async () => withApp(async ({ post, state }) => {
  const srv = await createServer({ name: 'Test', port: 0, password: 'pw', resourcesDir: 'resources', autostart: ['hello'] });
  const address = `localhost:${srv.net.port}`;
  const s = async () => (await state()).session;
  const info = await post('/api/query', { address });
  assert.deepEqual([info.online, info.name, info.password, info.players], [true, 'Test', true, 0]);
  assert.deepEqual(await post('/api/query', { address: 'localhost:1' }), { online: false });
  assert.deepEqual(await post('/api/query', { address: 'pas valide ::' }), { online: false });

  await post('/api/settings', { name: 'Alice' });
  await post('/api/connect', { address, password: 'faux' });
  await until(async () => (await s()).error, 'refus');
  assert.deepEqual([(await s()).error, (await s()).address], ['mot de passe incorrect', address]);
  assert.deepEqual((await state()).settings.recents, [], 'un échec n\'est pas mémorisé');

  await post('/api/connect', { address, password: 'pw' });
  await assert.rejects(post('/api/connect', { address }), /déjà connecté/);
  await until(async () => (await s()).status === 'connected', 'connexion');
  assert.equal((await s()).serverName, 'Test');
  const bob = new SixMClient({ url: `ws://${address}`, name: 'Bob', password: 'pw', adapter: new MockAdapter() });
  await bob.connect();
  await post('/api/chat', { text: 'coucou' });
  await until(async () => (await s()).log.some((l) => l.text === 'Alice: coucou'), 'chat');
  await until(async () => (await s()).players.some((p) => p.name === 'Bob'), 'Bob visible');
  assert.deepEqual((await state()).settings.recents, [address]);
  assert.ok(!JSON.stringify((await state()).settings).includes('pw'), 'mot de passe jamais gardé');

  await post('/api/disconnect');
  assert.equal((await s()).status, 'idle');
  await until(() => srv.world.players.size === 1, 'départ vu par le serveur');
  await post('/api/connect', { address, password: 'pw' });
  await until(async () => (await s()).status === 'connected', 'reconnexion');
  await bob.disconnect();
  await srv.stop();
  await until(async () => (await s()).status === 'idle', 'arrêt du serveur');
  assert.equal((await s()).error, 'serveur arrêté');
  await post('/api/connect', { address });
  await until(async () => (await s()).error === 'aucun serveur à cette adresse', 'erreur lisible');
}));

test('VIctory avec un bridge déjà présent : attente annulable puis position', async () => {
  const bridgePort = await freePort();
  await withApp(async ({ post, state }) => {
    const srv = await createServer({ name: 'V', port: 0 });
    const address = `localhost:${srv.net.port}`;
    await post('/api/settings', { target: 'attach' });
    // Un bridge muet occupe le port : l'attente doit pouvoir être annulée.
    const mute = net.createServer().listen(bridgePort, '127.0.0.1');
    await post('/api/connect', { address });
    assert.equal((await state()).session.status, 'connecting');
    await post('/api/disconnect');
    assert.deepEqual([(await state()).session.status, (await state()).session.error], ['idle', null]);

    await new Promise((r) => mute.close(r));

    const bridge = await startSimBridge({ port: bridgePort, path: () => ({ x: 7, y: 0, z: 0, h: 0 }) });
    await post('/api/connect', { address });
    await until(async () => (await state()).session.local?.x === 7, 'position du jeu');
    assert.equal(srv.world.players.size, 1, 'la tentative annulée n\'a pas rejoint');
    await post('/api/disconnect');
    await bridge.close(); await srv.stop();
  }, { adapterOptions: { port: bridgePort, retryMs: 50 } });
});

test('héberger : créer, démarrer, mods à chaud, console, réglages, arrêt', async () => withApp(async ({ post, raw, state, dataDir }) => {
  const port = await freePort();
  await assert.rejects(post('/api/hosts', { name: ' ', port }), /nom/);
  await assert.rejects(post('/api/hosts', { name: 'X', port: 99999 }), /"port"/);
  const { id } = await post('/api/hosts', { name: 'Été à Vice', port, maxPlayers: 4, password: 'pw', bansFile: 'C:/x' });
  assert.equal(id, 'sixm-ete-a-vice');
  assert.equal((await post('/api/hosts', { name: 'Été à Vice', port: port + 1 })).id, `${id}-2`);
  const host = async () => (await state()).hosts.find((x) => x.id === id);
  assert.deepEqual([(await host()).status, (await host()).hasPassword], ['stopped', true]);
  assert.ok(!JSON.stringify(await state()).includes('"pw"'), 'mot de passe non renvoyé');
  assert.ok(!fs.readFileSync(path.join(dataDir, 'servers', id, 'server.json'), 'utf8').includes('C:/x'), 'clé non modifiable ignorée');

  await post('/api/hosts/start', { id });
  await assert.rejects(post('/api/hosts/start', { id }), /déjà démarré/);
  await until(async () => (await host()).status === 'running', 'démarrage');

  await post(`/api/hosts/import?id=${id}&file=accueil.zip`, mod('accueil'));
  assert.deepEqual((await host()).mods.map((m) => [m.name, m.enabled]), [['accueil', false], ['hello', true], ['menu', true]]);
  await post('/api/hosts/mod', { id, name: 'accueil', enabled: true });
  await until(async () => (await host()).log.some((l) => l.includes('démarrée: accueil')), 'mod démarré à chaud');
  await assert.rejects(post('/api/hosts/mod', { id, name: '../x', enabled: true }), /mod inconnu/);

  await post('/api/hosts/play', { id }); // sans retaper le mot de passe
  await until(async () => (await state()).session.log.some((l) => l.text === 'bienvenue Joueur'), 'mod reçu par le joueur');
  await post('/api/hosts/command', { id, line: 'say bonjour\nquit' });
  await until(async () => (await state()).session.log.some((l) => l.text === '[Serveur] bonjour quit'), 'console, une seule ligne');

  await post('/api/hosts/update', { id, name: 'Nouveau', maxPlayers: 8 });
  assert.deepEqual([(await host()).name, (await host()).stale, (await host()).hasPassword], ['Nouveau', true, true]);
  await assert.rejects(post('/api/hosts/update', { id, port: 'x' }), /"port"/);

  await post('/api/hosts/stop', { id });
  assert.equal((await host()).status, 'stopped');
  await assert.rejects(post('/api/hosts/command', { id, line: 'x' }), /pas démarré/);
  for (const bad of ['../..', '', null, 'x']) await assert.rejects(post('/api/hosts/start', { id: bad }), /serveur inconnu/);

  const blocker = http.createServer();
  await new Promise((r) => blocker.listen(port, r));
  await post('/api/hosts/start', { id });
  await until(async () => (await host()).status === 'failed', 'port occupé');
  assert.ok((await host()).log.some((l) => l.includes('déjà utilisé')));
  blocker.close();

  // Export : réglages et mods, sans les bannissements.
  fs.writeFileSync(path.join(dataDir, 'servers', id, 'bans.json'), '[]');
  const res = await raw('/api/pack', { method: 'POST', body: JSON.stringify({ id }) });
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const names = readZip(Buffer.from(await res.arrayBuffer())).map((f) => f.name);
  assert.ok(names.includes('SixM-Server/resources/accueil/s.js'));
  assert.ok(!names.some((n) => n.endsWith('bans.json')));

  fs.writeFileSync(path.join(dataDir, 'servers', id, 'server.json'), '{cassé');
  assert.ok((await host()).broken, 'un serveur illisible n\'empêche pas la liste');
  assert.equal((await state()).hosts.length, 2);
}));

test('fermer l\'application arrête les serveurs hébergés', async () => {
  const port = await freePort();
  await withApp(async ({ post, state }) => {
    const { id } = await post('/api/hosts', { name: 'A', port });
    await post('/api/hosts/start', { id });
    await until(async () => (await state()).hosts[0].status === 'running', 'démarrage');
  });
  await assert.rejects(fetch(`http://localhost:${port}/info.json`));
});

test('serveur téléchargé : se lance seul, hors du dépôt, avec un mod déposé', async () => {
  const dir = tmp();
  for (const f of readZip(packServer())) {
    const file = path.join(dir, f.name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, f.data);
  }
  const root = path.join(dir, 'SixM-Server');
  for (const f of ['start.bat', 'start.sh', 'Dockerfile', 'LISEZMOI.txt', 'server.json', 'resources/hello/server.js'])
    assert.ok(fs.existsSync(path.join(root, f)), f);
  importMod(path.join(root, 'resources'), mod('accueil'));

  const p = spawn(process.execPath, ['sixm/bin/sixm.js', 'start', '.'], { cwd: root, env: { ...process.env, SIXM_PORT: '0' } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  await until(() => /localhost:\d+/.test(out), 'démarrage');
  const a = new MockAdapter();
  const c = new SixMClient({ url: `ws://localhost:${out.match(/localhost:(\d+)/)[1]}`, name: 'Léa', adapter: a });
  await c.connect();
  await until(() => a.logs.includes('bienvenue Léa'), 'mod déposé actif');
  await c.disconnect();
  p.stdin.write('quit\n');
  assert.equal(await new Promise((r) => p.on('exit', r)), 0);

  // Sans argument : pas d'interface dans le pack, donc l'aide.
  const help = spawn(process.execPath, ['sixm/bin/sixm.js'], { cwd: root });
  let text = '';
  help.stdout.on('data', (d) => (text += d));
  assert.equal(await new Promise((r) => help.on('close', r)), 0);
  assert.match(text, /usage/);
  fs.rmSync(dir, { recursive: true, maxRetries: 5 });
});

test('zip lisible par Windows', { skip: process.platform !== 'win32' }, async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 's.zip'), packServer());
  const tar = spawn('C:\\Windows\\System32\\tar.exe', ['-xf', 's.zip'], { cwd: dir });
  assert.equal(await new Promise((r) => tar.on('close', r)), 0);
  assert.ok(fs.existsSync(path.join(dir, 'SixM-Server', 'start.bat')));
  fs.rmSync(dir, { recursive: true, maxRetries: 5 });
});

test('identité, liste blanche et menus depuis l\'application', async () => withApp(async ({ post, state, dataDir }) => {
  const { settings } = await state();
  assert.match(settings.uid, /^sixm:[0-9a-f]{20}$/);
  assert.ok(!JSON.stringify(await state()).includes('privateKey'), 'clé privée jamais montrée');
  assert.equal(new Settings(dataDir).public().uid, settings.uid, 'identité stable entre deux lancements');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dataDir, 'settings.json')).mode & 0o077, 0, 'fichier privé');
  assert.ok(!JSON.stringify(await post('/api/settings', { name: 'Ana' })).includes('privateKey'));

  // Serveur hébergé, privé, à liste blanche : on se fait refuser, puis on s'accepte depuis l'application.
  const port = await freePort();
  const { id } = await post('/api/hosts', { name: 'Club', port, visibility: 'private', whitelist: true, tags: ['RP'] });
  const host = async () => (await state()).hosts.find((x) => x.id === id);
  assert.deepEqual([(await host()).visibility, (await host()).whitelist, (await host()).tags], ['private', true, ['RP']]);
  await post('/api/hosts/start', { id });
  await until(async () => (await host()).status === 'running', 'démarrage');
  await post('/api/connect', { address: `localhost:${port}` });
  await until(async () => (await state()).session.error?.includes('liste blanche'), 'refus');
  await until(async () => (await host()).access.requests.length === 1, 'demande visible');
  await post('/api/hosts/access', { id, action: 'approve', uid: settings.uid });
  await post('/api/hosts/access', { id, action: 'admin', uid: settings.uid, name: 'Ana' });
  assert.deepEqual((await host()).access.whitelist.map((e) => e.uid), [settings.uid]);
  await assert.rejects(post('/api/hosts/access', { id, action: 'approve', uid: 'x' }), /identifiant invalide/);

  await post('/api/connect', { address: `localhost:${port}` });
  await until(async () => (await state()).session.status === 'connected', 'accepté');
  await until(async () => (await host()).players.some((p) => p.uid === settings.uid && p.admin), 'joueurs vus par l\'hôte');
  assert.equal((await state()).session.uid, settings.uid);
  await post('/api/menu/open');
  await until(async () => (await state()).session.menu?.id === 'sixm:main', 'menu principal');
  assert.ok((await state()).session.menu.items.some((i) => i.id === 'admin'), 'admin : administration visible');
  await post('/api/menu/select', { menu: 'sixm:main', item: 'profil' });
  await until(async () => (await state()).session.menu?.open?.[0] === 'profil', 'menu profil, dans le menu principal');
  await post('/api/menu/close');
  assert.equal((await state()).session.menu, null);
  await post('/api/disconnect');
  await post('/api/hosts/stop', { id });
}));
