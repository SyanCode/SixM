import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';
import { cleanAvatar, cleanModel, cleanModels, defaultModel, parseObj } from '../server/avatars.js';
import { SixMClient } from '../client/client.js';
import { MockAdapter } from '../client/adapters/mock.js';

const until = async (cond, what, ms = 5000) => {
  const end = Date.now() + ms;
  while (!await cond()) {
    if (Date.now() > end) assert.fail(`délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const page = (menu) => {
  let m = menu;
  for (const id of menu?.open ?? []) m = m?.items.find((i) => i.id === id)?.menu;
  return m ?? null;
};

test('modèles OBJ : sommets, polygones découpés, couleurs, bornes', () => {
  const m = parseObj('# carré\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nusemtl #FF8800\nf 1/1/1 2/2/2 3 4\nusemtl verre\nf -4 -3 -2\n');
  assert.deepEqual(m, { v: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], f: [0, 1, 2, 0, 2, 3, 0, 1, 2], c: [0xff8800, 0xff8800, -1] });
  for (const bad of ['v 0 0\nf 1 1 1', 'v 0 0 0\nf 1 2 3', 'v 0 0 99999\nf 1 1 1', 'v 0 0 0']) assert.throws(() => parseObj(bad), bad);
  assert.throws(() => cleanModel({ v: [0, 0, 0], f: [0, 0, 1], c: [-1] }), /faces/);
  assert.deepEqual(Object.keys(cleanModels({ ok: defaultModel(), '../x': defaultModel(), mauvais: { v: [] } })), ['ok']);
  assert.deepEqual(cleanAvatar({ model: 'robot', scale: 99, color: '#ABCDEF' }), { model: 'robot', scale: 10, color: '#abcdef' });
  assert.deepEqual(cleanAvatar({ model: '<b>', scale: 'grand' }), { model: 'sixm:humain', scale: 1, color: null });
});

test('avatars : modèles des mods envoyés aux joueurs, avatar choisi dans le menu et vu par les autres', async (t) => {
  const srv = await createServer({ name: 't', port: 0, tickRate: 50, resourcesDir: 'resources', autostart: ['menu', 'avatars'] });
  const url = `ws://localhost:${srv.net.port}`;
  const a = Object.assign(new MockAdapter(), { local: { x: 1, y: 2, z: 3, h: 0 } }), b = new MockAdapter();
  const ca = new SixMClient({ url, name: 'Ana', adapter: a, posIntervalMs: 20 });
  const cb = new SixMClient({ url, name: 'Bob', adapter: b, posIntervalMs: 20 });
  t.after(async () => { await ca.disconnect(); await cb.disconnect(); await srv.stop(); });
  await ca.connect(); await cb.connect();
  assert.deepEqual(Object.keys(b.models).sort(), ['robot', 'sixm:humain']);
  await until(() => b.remotes.get(ca.id)?.avatar, 'Ana vue par Bob');
  assert.deepEqual(b.remotes.get(ca.id).avatar, { model: 'sixm:humain', scale: 1, color: null });

  ca.openMenu();
  await until(() => ca.menu?.id === 'sixm:main', 'menu');
  ca.selectMenu('sixm:main', 'profil');
  await until(() => page(ca.menu)?.items.some((i) => i.id === 'modele'), 'profil');
  const list = page(ca.menu).items.find((i) => i.id === 'modele').options;
  ca.selectMenu('profil', 'modele', list.indexOf('Robot'));
  ca.selectMenu('profil', 'taille', 150);
  ca.selectMenu('profil', 'couleur', 2);
  await until(() => JSON.stringify(b.remotes.get(ca.id)?.avatar) === JSON.stringify({ model: 'robot', scale: 1.5, color: '#e5484d' }), 'avatar vu par Bob, sans que Ana bouge');

  // Un mod arrêté : ses modèles partent, l'avatar revient au modèle par défaut chez les autres.
  srv.resources.stop('avatars');
  await until(() => !('robot' in b.models), 'modèles renvoyés');
});
