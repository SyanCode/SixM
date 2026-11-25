import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createServer } from '../server/index.js';
import { loadConfig, normalizeConfig } from '../server/config.js';
import { BanList } from '../server/bans.js';
import { runCommand } from '../server/console.js';
import { SixMClient } from '../client/client.js';
import { MockAdapter } from '../client/adapters/mock.js';
import { serverUrl } from '../client/address.js';

const cli = fileURLToPath(new URL('../bin/sixm.js', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-'));
const serve = (extra = {}) => createServer({ name: 't', port: 0, tickRate: 50, ...extra });
const client = (srv, opts = {}) => new SixMClient({
  url: `ws://localhost:${srv.net.port}`, name: 'A', adapter: new MockAdapter(), posIntervalMs: 20, ...opts,
});
const until = async (cond, what, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) assert.fail(`délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('configuration : défauts, erreurs lisibles, BOM et chemins relatifs', () => {
  assert.equal(normalizeConfig({}).port, 30120);
  assert.throws(() => normalizeConfig({ port: '30120' }), /"port"/);
  assert.throws(() => normalizeConfig({ autostart: 'hello' }), /"autostart"/);
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'server.json'), '﻿{"name":"X"}');
  const c = loadConfig(dir);
  assert.equal(c.resourcesDir, path.join(dir, 'resources'));
  assert.equal(c.bansFile, path.join(dir, 'bans.json'));
  fs.writeFileSync(path.join(dir, 'server.json'), '{oups');
  assert.throws(() => loadConfig(dir), /impossible de lire/);
  fs.rmSync(dir, { recursive: true });
});

test('adresses : hôte, port, IPv6, URL', () => {
  assert.equal(serverUrl('exemple.fr'), 'ws://exemple.fr:30120/');
  assert.equal(serverUrl('1.2.3.4:5'), 'ws://1.2.3.4:5/');
  assert.equal(serverUrl('[::1]'), 'ws://[::1]:30120/');
  assert.equal(serverUrl('wss://jeu.exemple.fr'), 'wss://jeu.exemple.fr');
});

test('mot de passe : refus, accès, puis blocage après 5 échecs', async () => {
  const srv = await serve({ password: 'secret' });
  await assert.rejects(client(srv).connect(), /mot de passe incorrect/);
  await assert.rejects(client(srv, { password: 'non' }).connect(), /mot de passe incorrect/);
  const ok = client(srv, { password: 'secret' });
  await ok.connect();
  await ok.disconnect();
  for (let i = 0; i < 5; i++) await assert.rejects(client(srv, { password: 'x' }).connect(), /incorrect/);
  await assert.rejects(client(srv, { password: 'secret' }).connect(), /trop de tentatives/);
  assert.equal(srv.world.players.size, 0);
  await srv.stop();
});

test('info.json et players.json : publics, sans secret ni IP', async () => {
  const srv = await serve({ password: 'secret', description: 'desc' });
  const c = client(srv, { password: 'secret', name: 'Alice' });
  await c.connect();
  const base = `http://localhost:${srv.net.port}`;
  const infoText = await (await fetch(`${base}/info.json`)).text();
  const info = JSON.parse(infoText);
  assert.equal(info.players, 1);
  assert.equal(info.password, true);
  assert.ok(!infoText.includes('secret'));
  assert.deepEqual(await (await fetch(`${base}/players.json`)).json(), [{ id: c.id, name: 'Alice' }]);
  assert.equal((await fetch(`${base}/../server.json`)).status, 404);
  assert.equal((await fetch(`${base}/info.json`, { method: 'POST' })).status, 404);
  await c.disconnect(); await srv.stop();
});

test('ban : expulsion, persistance, refus au retour, unban', async () => {
  const dir = tmp();
  const bansFile = path.join(dir, 'bans.json');
  let srv = await serve({ bansFile });
  let reason;
  const c = client(srv, { onDisconnect: (r) => { reason = r; } });
  await c.connect();
  runCommand(srv, `ban ${c.id} triche avérée`, () => {});
  await until(() => reason, 'expulsion');
  assert.equal(reason, 'banni : triche avérée');
  await srv.stop();

  srv = await serve({ bansFile });
  await assert.rejects(client(srv).connect(), /banni : triche avérée/);
  const [{ ip }] = srv.bans.list();
  runCommand(srv, `unban ${ip}`, () => {});
  const back = client(srv);
  await back.connect();
  await back.disconnect(); await srv.stop();

  fs.writeFileSync(bansFile, 'cassé');
  assert.throws(() => new BanList(bansFile), 'un fichier illisible ne lève pas les bans en silence');
  fs.rmSync(dir, { recursive: true });
});

test('console : kick, say, commandes invalides', async () => {
  const srv = await serve({ resourcesDir: 'resources', autostart: ['hello'] });
  const a = new MockAdapter();
  let reason;
  const c = client(srv, { adapter: a, onDisconnect: (r) => { reason = r; } });
  await c.connect();
  runCommand(srv, 'say  bonjour à tous ');
  await until(() => a.logs.includes('[Serveur] bonjour à tous'), 'say');
  assert.throws(() => runCommand(srv, 'kick 999'), /joueur inconnu/);
  assert.throws(() => runCommand(srv, 'stop rien'), /non démarrée/);
  runCommand(srv, '');
  runCommand(srv, `kick ${c.id} afk`);
  await until(() => reason === 'afk', 'kick');
  await srv.stop();
});

test('limite de connexions par IP et autostart cassé toléré', async () => {
  const srv = await serve({ maxConnectionsPerIp: 1, autostart: ['inexistante'] });
  const a = client(srv);
  await a.connect();
  await assert.rejects(client(srv).connect(), /trop de connexions/);
  await a.disconnect();
  await until(() => srv.net.connections.size === 0, 'compteur remis à zéro');
  const b = client(srv);
  await b.connect();
  await b.disconnect(); await srv.stop();
});

test('trustProxy : IP du proxy seulement si activé', async () => {
  const ipSeen = async (trustProxy) => {
    const srv = await serve({ trustProxy });
    const ws = new WebSocket(`ws://127.0.0.1:${srv.net.port}`, { headers: { 'x-forwarded-for': '6.6.6.6, 9.9.9.9' } });
    ws.on('open', () => ws.send('{"t":"hello","name":"A"}'));
    await until(() => srv.world.players.size, 'joueur');
    const { ip } = [...srv.world.players.values()][0];
    await srv.stop();
    return ip;
  };
  assert.equal(await ipSeen(false), '127.0.0.1');
  assert.equal(await ipSeen(true), '9.9.9.9');
});

test('port occupé : erreur claire', async () => {
  const srv = await serve();
  await assert.rejects(serve({ port: srv.net.port }), /EADDRINUSE/);
  await srv.stop();
});

test('CLI : init puis start, info, connexion et arrêt', async () => {
  const dir = path.join(tmp(), 'mon serveur é');
  const init = () => spawnSync(process.execPath, [cli, 'init', dir], { encoding: 'utf8' });
  assert.equal(init().status, 0);
  for (const f of ['server.json', 'start.bat', 'start.sh', '.gitignore', 'resources/hello/server.js'])
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  const again = init();
  assert.equal(again.status, 1);
  assert.match(again.stderr, /existe déjà/);

  const p = spawn(process.execPath, [cli, 'start', dir], { env: { ...process.env, SIXM_PORT: '0', SIXM_PASSWORD: 'pw' } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  await until(() => /localhost:\d+/.test(out), 'démarrage');
  const port = out.match(/localhost:(\d+)/)[1];

  const info = spawnSync(process.execPath, [cli, 'info', `localhost:${port}`], { encoding: 'utf8' });
  assert.equal(JSON.parse(info.stdout).name, 'Mon serveur SixM');
  const a = new MockAdapter();
  let reason;
  const c = new SixMClient({ url: `ws://localhost:${port}`, name: 'Zoé', password: 'pw', adapter: a, onDisconnect: (r) => { reason = r; } });
  await c.connect();
  await until(() => a.logs.includes('Zoé a rejoint le serveur'), 'ressource hello');
  p.stdin.write('quit\n');
  const code = await new Promise((r) => p.on('exit', r));
  assert.equal(code, 0);
  await until(() => reason === 'serveur arrêté', 'raison d\'arrêt');
  fs.rmSync(path.dirname(dir), { recursive: true });
});
