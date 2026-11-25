import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createServer } from '../server/index.js';
import { SixMClient } from '../client/client.js';
import { MockAdapter } from '../client/adapters/mock.js';
import { VictoryAdapter } from '../client/adapters/victory.js';
import { PositionBuffer, lerpAngle } from '../client/interpolation.js';
import { startSimBridge } from '../integrations/victory/sim-bridge.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, what, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) assert.fail(`délai dépassé : ${what}`);
    await wait(10);
  }
};
const serve = (extra = {}) => createServer({
  name: 't', port: 0, maxPlayers: 4, tickRate: 50, resourcesDir: 'resources', autostart: [], ...extra,
});
const mockAt = (pos) => Object.assign(new MockAdapter(), { local: pos });
const at = (x) => ({ x, y: 0, z: 0, h: 0 });

test('interpolation : milieu, gel, téléportation, angle', () => {
  const b = new PositionBuffer();
  assert.equal(b.sample(0), null);
  b.push(0, at(0)); b.push(100, at(10));
  assert.equal(b.sample(50).x, 5);
  assert.equal(b.sample(500).x, 10, 'pas d\'extrapolation');
  b.push(200, at(1000));
  assert.equal(b.sample(150).x, 10, 'téléportation non lissée');
  assert.equal(b.sample(200).x, 1000);
  const h = lerpAngle(0.1, Math.PI * 2 - 0.1, 0.5);
  assert.ok(Math.abs(h) < 1e-9, 'plus court chemin');
});

test('lancement direct (npm start) : le serveur écoute vraiment', async () => {
  const script = fileURLToPath(new URL('../server/index.js', import.meta.url));
  const p = spawn(process.execPath, [script], { cwd: os.tmpdir(), env: { ...process.env, SIXM_PORT: '0' } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  await until(() => out.includes('en écoute'), 'démarrage');
  p.kill();
});

test('un message JSON null ne fait pas tomber le serveur', async () => {
  const srv = await serve();
  const ws = new WebSocket(`ws://localhost:${srv.net.port}`);
  await new Promise((r) => ws.on('open', r));
  ws.send('null');
  await new Promise((r) => ws.on('close', r));
  const c = new SixMClient({ url: `ws://localhost:${srv.net.port}`, name: 'A', adapter: new MockAdapter() });
  await c.connect();
  await c.disconnect(); await srv.stop();
});

test('serveur plein : connect() échoue avec la raison', async () => {
  const srv = await serve({ maxPlayers: 0 });
  const c = new SixMClient({ url: `ws://localhost:${srv.net.port}`, name: 'A', adapter: new MockAdapter() });
  await assert.rejects(c.connect(), /serveur plein/);
  await srv.stop();
});

test('perte du serveur : avatars retirés et onDisconnect appelé', async () => {
  const srv = await serve();
  const url = `ws://localhost:${srv.net.port}`;
  const a = new MockAdapter();
  let dropped = false;
  const ca = new SixMClient({ url, name: 'A', adapter: a, posIntervalMs: 20, onDisconnect: () => { dropped = true; } });
  const cb = new SixMClient({ url, name: 'B', adapter: mockAt(at(5)), posIntervalMs: 20 });
  await ca.connect(); await cb.connect();
  await until(() => a.remotes.has(cb.id), 'A voit B');
  await srv.stop();
  await until(() => dropped, 'onDisconnect');
  assert.equal(a.remotes.size, 0);
});

test('syncRadius : seuls les joueurs proches sont visibles', async () => {
  const srv = await serve({ syncRadius: 100 });
  const url = `ws://localhost:${srv.net.port}`;
  const a = mockAt(at(0)); const far = mockAt(at(1000));
  const mk = (name, adapter) => new SixMClient({ url, name, adapter, posIntervalMs: 20 });
  const ca = mk('A', a), cb = mk('B', mockAt(at(50))), cc = mk('C', far);
  for (const c of [ca, cb, cc]) await c.connect();
  await until(() => a.remotes.has(cb.id), 'A voit B');
  await wait(200);
  assert.equal(a.remotes.has(cc.id), false, 'C est trop loin');
  far.local = at(60);
  await until(() => a.remotes.has(cc.id), 'C entre dans le rayon');
  far.local = at(1000);
  await until(() => !a.remotes.has(cc.id), 'C sort du rayon');
  for (const c of [ca, cb, cc]) await c.disconnect();
  await srv.stop();
});

test('arrêt d\'une ressource : ses timers sont coupés', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-'));
  fs.mkdirSync(path.join(dir, 'tick'));
  fs.writeFileSync(path.join(dir, 'tick', 'resource.json'), '{"name":"tick","server":["s.js"]}');
  fs.writeFileSync(path.join(dir, 'tick', 's.js'), 'setInterval(() => sixm.kick(-1), 5);');
  const srv = await serve({ resourcesDir: dir, autostart: ['tick'] });
  let n = 0;
  srv.net.kick = () => { n++; };
  await until(() => n > 0, 'le timer tourne');
  srv.resources.stop('tick');
  const before = n;
  await wait(60);
  assert.equal(n, before);
  await srv.stop();
  fs.rmSync(dir, { recursive: true });
});

test('bridge redémarré : reconnexion et renvoi des avatars', async () => {
  const srv = await serve();
  const url = `ws://localhost:${srv.net.port}`;
  let bridge = await startSimBridge({ port: 0, path: () => at(1) });
  const port = bridge.port;
  const va = new VictoryAdapter({ port, retryMs: 20 });
  const cv = new SixMClient({ url, name: 'Vic', adapter: va, posIntervalMs: 20 });
  const cm = new SixMClient({ url, name: 'Autre', adapter: mockAt(at(9)), posIntervalMs: 20 });
  await cv.connect(); await cm.connect();
  await until(() => bridge.remotes.get(cm.id)?.x === 9, 'avatar dans le bridge');
  await until(() => srv.world.players.get(cv.id).pos.x === 1, 'position du bridge au serveur');

  await bridge.close();
  await until(() => va.getLocalPlayerPosition() === null, 'position inconnue sans bridge');
  bridge = await startSimBridge({ port, path: () => at(2) });
  // `Autre` n'a pas bougé : sans renvoi, le nouveau bridge ne le verrait jamais.
  await until(() => bridge.remotes.get(cm.id)?.x === 9, 'avatar renvoyé');
  await until(() => srv.world.players.get(cv.id).pos.x === 2, 'synchro reprise');

  await cm.disconnect();
  await until(() => !bridge.remotes.has(cm.id), 'avatar retiré');
  await cv.disconnect(); await bridge.close(); await srv.stop();
});
