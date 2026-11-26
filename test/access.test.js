import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../server/index.js';
import { normalizeConfig } from '../server/config.js';
import { AccessList } from '../server/access.js';
import { createIdentity, playerUid, signChallenge, verifyChallenge } from '../server/identity.js';
import { cleanMenu } from '../server/menus.js';
import { startDirectory } from '../server/directory.js';
import { runCommand } from '../server/console.js';
import { SixMClient } from '../client/client.js';
import { MockAdapter } from '../client/adapters/mock.js';
import { fetchDirectories } from '../app/discovery.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-'));
const serve = (extra = {}) => createServer({ name: 't', port: 0, tickRate: 50, ...extra });
const client = (srv, opts = {}) => new SixMClient({
  url: `ws://localhost:${srv.net.port}`, name: 'A', adapter: new MockAdapter(), posIntervalMs: 20, ...opts,
});
const until = async (cond, what, ms = 5000) => {
  const end = Date.now() + ms;
  while (!await cond()) {
    if (Date.now() > end) assert.fail(`délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('identité : signature vérifiée, clé d\'un autre refusée', () => {
  const a = createIdentity(), b = createIdentity();
  const sig = signChallenge(a, 'n1');
  assert.ok(verifyChallenge(a.publicKey, 'n1', sig));
  assert.ok(!verifyChallenge(a.publicKey, 'n2', sig), 'défi rejoué');
  assert.ok(!verifyChallenge(b.publicKey, 'n1', sig), 'clé d\'un autre');
  assert.ok(!verifyChallenge('pas une clé', 'n1', sig));
  assert.match(playerUid(a.publicKey), /^sixm:[0-9a-f]{20}$/);
  assert.notEqual(playerUid(a.publicKey), playerUid(b.publicKey));
});

test('liste blanche : demande, acceptation, admin, usurpation impossible', async () => {
  const dir = tmp();
  const accessFile = path.join(dir, 'access.json');
  const srv = await serve({ whitelist: true, accessFile, maxPlayers: 1 });
  const ana = createIdentity(), uid = playerUid(ana.publicKey);

  await assert.rejects(client(srv, { name: 'Ana', identity: ana }).connect(), /liste blanche : demande envoyée/);
  await assert.rejects(client(srv, { name: 'Ana' }).connect(), /mettez SixM à jour/, 'sans identité');
  assert.deepEqual(srv.access.data.requests.map((r) => [r.uid, r.name]), [[uid, 'Ana']]);

  // L'application accepte depuis le fichier, puis le serveur le relit.
  new AccessList(accessFile).add(uid);
  runCommand(srv, 'access reload', () => {});
  assert.equal(srv.access.data.requests.length, 0);
  const c = client(srv, { name: 'Ana', identity: ana });
  await c.connect();
  assert.equal(c.uid, uid);

  // Même pseudo, autre clé : refusé ; même clé deux fois : refusé.
  await assert.rejects(client(srv, { name: 'Ana', identity: createIdentity() }).connect(), /liste blanche/);
  await assert.rejects(client(srv, { name: 'Ana2', identity: ana }).connect(), /déjà connecté/);

  runCommand(srv, `admin ${c.id}`, () => {});
  await until(() => c.roster.find((p) => p.id === c.id)?.admin, 'roster admin');
  assert.ok(srv.access.isAdmin(uid));
  assert.ok(JSON.parse(fs.readFileSync(accessFile, 'utf8')).admins.some((e) => e.uid === uid), 'admin gardé dans access.json');

  // Ban par identifiant : même depuis une autre IP, la clé est refusée.
  runCommand(srv, `ban ${c.id} test`, () => {});
  await until(() => srv.world.players.size === 0, 'expulsé');
  assert.equal(srv.bans.list()[0].uid, uid);
  assert.ok(srv.bans.get('203.0.113.9', uid), 'bannissement par identifiant');
  await srv.stop();

  fs.writeFileSync(accessFile, 'cassé');
  assert.throws(() => new AccessList(accessFile), 'fichier illisible : on n\'ouvre pas le serveur');
  fs.rmSync(dir, { recursive: true });
});

test('serveur privé : fiche publique sans joueurs, options validées', async () => {
  assert.throws(() => normalizeConfig({ visibility: 'secret' }), /"visibility"/);
  assert.throws(() => normalizeConfig({ tags: ['a'.repeat(30)] }), /"tags"/);
  assert.throws(() => normalizeConfig({ directories: ['file:///etc'] }), /"directories"/);
  const srv = await serve({ visibility: 'private', tags: ['RP', 'FR'], motd: 'Bienvenue !' });
  const base = `http://localhost:${srv.net.port}`;
  const info = await (await fetch(`${base}/info.json`)).json();
  assert.deepEqual([info.visibility, info.tags, info.whitelist], ['private', ['RP', 'FR'], false]);
  assert.equal((await fetch(`${base}/players.json`)).status, 403);
  const a = new MockAdapter();
  const c = client(srv, { adapter: a, identity: createIdentity() });
  await c.connect();
  assert.ok(a.logs.includes('Bienvenue !'), 'message d\'accueil');
  await c.disconnect(); await srv.stop();
});

test('menus : principal, ouverture, choix, entrée réservée aux admins, menus invalides', async () => {
  assert.throws(() => cleanMenu({ id: 'x' }), /menu invalide/);
  const m = cleanMenu({ id: 'm', items: [{ id: 'l', type: 'list', options: ['a', 'b'], value: 9 }, { id: 's', type: 'slider', min: 0, max: 10, value: -5 }, { type: 'nope', label: 'x\u0007' }] });
  assert.deepEqual([m.items[0].value, m.items[1].value, m.items[2].type, m.items[2].label], [1, 0, 'button', 'x ']);

  const srv = await serve({ resourcesDir: 'resources', autostart: ['hello', 'menu'] });
  const a = new MockAdapter(), me = createIdentity();
  const c = client(srv, { adapter: a, identity: me, name: 'Ana' });
  const other = client(srv, { name: 'Bob', identity: createIdentity() });
  await c.connect(); await other.connect();
  c.openMenu();
  await until(() => c.menu?.id === 'sixm:main', 'menu principal');
  assert.deepEqual(c.menu.items.map((i) => i.id), ['profil', 'emotes'], 'pas d\'administration pour un joueur');

  c.selectMenu('sixm:main', 'emotes');
  await until(() => c.menu?.id === 'emotes', 'sous-menu');
  c.selectMenu('emotes', '0');
  await until(() => a.logs.includes('* Ana salue'), 'emote envoyée');

  // Un joueur forge un choix d'admin : ignoré.
  c.selectMenu('admin:joueur', `kick:${other.id}`);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(srv.world.players.size, 2);

  srv.access.setAdmin(playerUid(me.publicKey), 'Ana', true);
  c.openMenu();
  await until(() => c.menu?.items.some((i) => i.id === 'admin'), 'administration visible');
  c.selectMenu('admin:joueur', `kick:${other.id}`);
  await until(() => srv.world.players.size === 1, 'expulsion depuis le menu');

  srv.resources.stop('menu');
  c.openMenu();
  await until(() => a.logs.includes('Aucun menu sur ce serveur.'), 'entrées retirées avec la ressource');
  await c.disconnect(); await srv.stop();
});

test('annuaire : inscription vérifiée, serveurs privés refusés, liste', async () => {
  const dir = await startDirectory({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${dir.port}`;
  const pub = await serve({ name: 'Public', tags: ['FR'] });
  const priv = await serve({ name: 'Secret', visibility: 'private' });
  const announce = (port) => fetch(`${base}/announce`, { method: 'POST', body: JSON.stringify({ port }) });
  assert.equal((await announce(pub.net.port)).status, 200);
  assert.equal((await announce(priv.net.port)).status, 403);
  assert.equal((await announce(1)).status, 422, 'rien n\'écoute');
  assert.equal((await announce('x')).status, 400);
  const list = await fetchDirectories([base]);
  assert.deepEqual(list.map((s) => [s.address, s.name, s.tags]), [[`127.0.0.1:${pub.net.port}`, 'Public', ['FR']]]);
  assert.deepEqual(await fetchDirectories(['http://127.0.0.1:1']), [], 'annuaire injoignable');
  await pub.stop(); await priv.stop(); await dir.close();
});
