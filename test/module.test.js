import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { GameModule } from '../client/module.js';
import { VictoryAdapter } from '../client/adapters/victory.js';
import { startLink } from '../client/link.js';
import { lockPackages, moduleSource } from '../app/builder.js';

const skip = process.platform !== 'win32' && 'Windows seulement';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, what, ms = 5000) => {
  const end = Date.now() + ms;
  while (!await cond()) {
    if (Date.now() > end) assert.fail(`délai dépassé : ${what}`);
    await wait(20);
  }
};
/** Faux module : même protocole que sixm-bridge. */
async function fakeModule(token) {
  const socks = [];
  const srv = net.createServer((s) => {
    s.on('error', () => {});
    s.setEncoding('utf8').once('data', (d) => { if (d.trim() === token) socks.push(s); else s.destroy(); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, socks, send: (m) => socks.at(-1).write(typeof m === 'string' ? m : JSON.stringify(m) + '\n'), close: () => { socks.forEach((s) => s.destroy()); srv.close(); } };
}

test('module : jeton, position, caméra, données invalides ignorées, reconnexion', async () => {
  const fake = await fakeModule('jeton-de-test-0123');
  const cameras = [];
  const m = new GameModule({ port: fake.port, token: 'jeton-de-test-0123', retryMs: 20, onCamera: (c) => cameras.push(c) });
  await until(() => fake.socks.length === 1, 'connexion');
  fake.send({ t: 'ready', build: 'abc-123', profile: true, error: null });
  fake.send({ t: 'localPlayer', x: 1, y: 2, z: 3, h: 0 });
  fake.send({ t: 'camera', m: Array(16).fill(1) });
  await until(() => cameras.length, 'caméra');
  assert.deepEqual(m.state(), { connected: true, build: 'abc-123', profile: true, error: null, located: true });
  for (const bad of ['{oups\n', 'null\n', { t: 'localPlayer', x: 'a', y: 0, z: 0, h: 0 }, { t: 'camera', m: [1] }, { t: 'camera', m: Array(16).fill(null) }, { t: 'ready', build: '../x', profile: 1, error: 5 }]) fake.send(bad);
  await until(() => m.build === null, 'ready invalide');
  assert.deepEqual([m.position.x, cameras.length, m.profile, m.error], [1, 1, false, null]);
  fake.socks[0].destroy();
  await until(() => fake.socks.length === 2, 'reconnexion');
  assert.equal(m.position, null, 'position oubliée avec le jeu');
  m.stop();
  fake.close();
  const wrong = await fakeModule('un-autre-jeton-0123');
  const w = new GameModule({ port: wrong.port, token: 'faux', retryMs: 20 });
  await wait(150);
  assert.deepEqual([w.connected, wrong.socks.length], [false, 0]);
  w.stop();
  wrong.close();
});

test('du module à la surcouche : les joueurs sont placés à l\'écran', { skip }, async () => {
  const fake = await fakeModule('jeton-de-test-0123');
  const link = await startLink({ port: 0, dir: path.join(os.tmpdir(), 'sixm-test-link') });
  const a = new VictoryAdapter({ port: link.port });
  await a.init();
  a.useModule(new GameModule({ port: fake.port, token: 'jeton-de-test-0123', retryMs: 20 }));
  await until(() => fake.socks.length, 'module');
  fake.send({ t: 'localPlayer', x: 0, y: 0, z: 0, h: 0 });
  await until(() => a.getLocalPlayerPosition(), 'position');
  // Caméra en (0,0,0) regardant vers +Y : clip = (x, z, y, y).
  const view = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0];
  a.setRemotePlayer(1, 'Devant', { x: 0, y: 30, z: 0, h: 0 });
  a.setRemotePlayer(2, 'À droite', { x: 10, y: 20, z: 2, h: 0 });
  a.setRemotePlayer(3, 'Derrière', { x: 0, y: -30, z: 0, h: 0 });
  a.setRemotePlayer(4, 'Hors champ', { x: 100, y: 10, z: 0, h: 0 });
  const png = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-')), 'o.png');
  const timer = setInterval(() => fake.send({ t: 'camera', m: view }), 30);
  await until(async () => (await link.dump(png)).endsWith('markers=2'), 'deux joueurs visibles');
  clearInterval(timer);
  assert.ok(fs.statSync(`${png}.markers.png`).size > 1500);
  if (process.env.SIXM_OVERLAY_PNG) fs.copyFileSync(`${png}.markers.png`, process.env.SIXM_OVERLAY_PNG);
  await wait(1300);
  assert.match(await link.dump(png), /markers=0/, 'plus de caméra : plus de noms');
  await a.shutdown();
  fake.close();
  await link.stop();
});

test('verrou de cargo et empreinte du module', () => {
  const lock = '[[package]]\nname = "a"\nversion = "1.0.0"\nchecksum = "x"\n\n[[package]]\r\nname = "b"\r\nversion = "2.0.0"\r\n';
  assert.deepEqual([...lockPackages(lock)], ['a 1.0.0 x', 'b 2.0.0 ']);
  const m = moduleSource();
  assert.match(m.id, /^[0-9a-f]{12}$/);
  assert.deepEqual(m.files.map((f) => f.name), ['Cargo.toml', 'src/lib.rs', 'src/memory.rs', 'src/profile.rs']);
});
