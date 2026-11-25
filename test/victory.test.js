import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createServer } from '../server/index.js';
import { SixMClient } from '../client/client.js';
import { VictoryAdapter } from '../client/adapters/victory.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeBridge(build = 'build-A') {
  const received = [];
  let sock;
  const srv = net.createServer((s) => {
    sock = s; s.setEncoding('utf8');
    s.write(JSON.stringify({ t: 'ready', build }) + '\n');
    let buf = '';
    s.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { received.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () =>
    res({ port: srv.address().port, received, push: (m) => sock.write(JSON.stringify(m) + '\n'), close: () => { sock?.destroy(); srv.close(); } })));
}

test('refuse un hôte non loopback', () => {
  assert.throws(() => new VictoryAdapter({ host: '10.0.0.5' }), /loopback/);
});

test('refuse un build non pris en charge', async () => {
  const b = await fakeBridge('inconnu');
  const a = new VictoryAdapter({ port: b.port, allowedBuilds: ['build-A'], connectTimeoutMs: 2000 });
  await assert.rejects(a.init(), /non pris en charge/);
  b.close();
});

test('SixM de bout en bout via le bridge', async () => {
  const srv = await createServer({ name: 't', port: 0, maxPlayers: 4, tickRate: 50, resourcesDir: 'resources', autostart: [] });
  const url = `ws://localhost:${srv.net.port}`;
  const bridge = await fakeBridge();
  const va = new VictoryAdapter({ port: bridge.port, allowedBuilds: ['build-A'] });
  const cv = new SixMClient({ url, name: 'Vic', adapter: va, posIntervalMs: 20 });
  await cv.connect();
  const other = new SixMClient({ url, name: 'Autre', adapter: Object.assign(new (await import('../client/adapters/mock.js')).MockAdapter(), { local: { x: 9, y: 8, z: 7, h: 6 } }), posIntervalMs: 20 });
  await other.connect();

  bridge.push({ t: 'localPlayer', x: 1, y: 2, z: 3, h: 4 });
  await wait(250);

  assert.deepEqual(srv.world.players.get(cv.id).pos, { x: 1, y: 2, z: 3, h: 4 }, 'position du jeu → serveur');
  assert.ok(bridge.received.some((m) => m.t === 'setRemote' && m.name === 'Autre' && m.x === 9), 'joueur distant → bridge');

  await other.disconnect(); await wait(200);
  assert.ok(bridge.received.some((m) => m.t === 'removeRemote'));
  await cv.disconnect(); bridge.close(); await srv.stop();
});
