import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';
import { SixMClient } from '../client/client.js';
import { MockAdapter } from '../client/adapters/mock.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('connexion, ressources, chat et synchro de position', async () => {
  const srv = await createServer({
    name: 'test', port: 0, maxPlayers: 4, tickRate: 50,
    resourcesDir: 'resources', autostart: ['hello'],
  });
  const url = `ws://localhost:${srv.net.port}`;
  const a = new MockAdapter(), b = new MockAdapter();
  const ca = new SixMClient({ url, name: 'Alice', adapter: a, posIntervalMs: 20 });
  const cb = new SixMClient({ url, name: 'Bob', adapter: b, posIntervalMs: 20 });
  await ca.connect(); await cb.connect();

  a.local = { x: 1, y: 2, z: 3, h: 4 };
  ca.emitServer('chat', 'coucou');
  await wait(200);

  assert.deepEqual(b.remotes.get(ca.id).pos, { x: 1, y: 2, z: 3, h: 4 });
  assert.ok(b.logs.includes('Alice: coucou'), 'le chat doit arriver à Bob');

  await cb.disconnect();
  await wait(200);
  assert.equal(a.remotes.has(cb.id), false);

  await ca.disconnect();
  await srv.stop();
});

test('arrêt d\'une ressource retire ses handlers', async () => {
  const srv = await createServer({
    name: 't', port: 0, maxPlayers: 2, tickRate: 20, resourcesDir: 'resources', autostart: ['hello'],
  });
  assert.ok(srv.resources.stop('hello'));
  assert.equal(srv.resources.running.size, 0);
  await srv.stop();
});
