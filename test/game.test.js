import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';
import { createIdentity, playerUid } from '../server/identity.js';
import { cleanAbilities, cleanAction } from '../server/game.js';
import { SixMClient } from '../client/client.js';
import { MockAdapter } from '../client/adapters/mock.js';
import { GameAdapter } from '../client/adapter.js';

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

test('actions sur le jeu : validées, et seulement ce que le jeu annonce', () => {
  assert.deepEqual(cleanAbilities({ teleport: 1, values: [{ name: 'noclip', type: 'u8' }, { name: 'noclip', type: 'u8' }, { name: 'X', type: 'u8' }, { name: 'a', type: 'u64' }] }),
    { teleport: false, values: [{ name: 'noclip', type: 'u8' }] });
  assert.deepEqual(cleanAction({ action: 'set', name: 'noclip', value: true, hold: true }), { action: 'set', name: 'noclip', value: 1, hold: true });
  assert.deepEqual(cleanAction({ action: 'teleport', x: 1, y: 2, z: 3, h: 'nord' }), { action: 'teleport', x: 1, y: 2, z: 3 });
  for (const bad of [{ action: 'teleport', x: 1, y: 2, z: 1e7 }, { action: 'set', name: '../x', value: 1 }, { action: 'set', name: 'x', value: 'beaucoup' }, { action: 'write', address: 4096 }, null])
    assert.throws(() => cleanAction(bad));
});

test('menus branchés sur le jeu : no clip, téléportation, refus du jeu sans profil', async (t) => {
  const srv = await createServer({ name: 't', port: 0, tickRate: 50, resourcesDir: 'resources', autostart: ['menu'] });
  const url = `ws://localhost:${srv.net.port}`;
  const me = createIdentity();
  const a = Object.assign(new MockAdapter(), { local: { x: 10, y: 20, z: 30, h: 0 } });
  const b = Object.assign(new MockAdapter(), { local: { x: -100, y: -200, z: 5, h: 0 } });
  // Un jeu sans profil : il ne permet rien.
  class Plain extends GameAdapter { async init() {} getLocalPlayerPosition() { return { x: 0, y: 0, z: 0, h: 0 }; } setRemotePlayer() {} removeRemotePlayer() {} log() {} }
  const ca = new SixMClient({ url, name: 'Ana', adapter: a, identity: me, posIntervalMs: 20 });
  const cb = new SixMClient({ url, name: 'Bob', adapter: b, posIntervalMs: 20 });
  const cc = new SixMClient({ url, name: 'Cid', adapter: new Plain(), posIntervalMs: 20 });
  t.after(async () => { await ca.disconnect(); await cb.disconnect(); await cc.disconnect(); await srv.stop(); });
  await ca.connect(); await cb.connect(); await cc.connect();
  const view = (c) => [...srv.world.players.values()].find((p) => p.id === c.id);
  await until(() => view(ca)?.game?.teleport && view(cb)?.located && view(cc)?.game, 'capacités reçues');
  assert.deepEqual(view(ca).game.values.map((v) => v.name), ['noclip', 'invincible']);
  assert.deepEqual(view(cc).game, { teleport: false, values: [] });

  // Joueur ordinaire : pas d'entrée « Mon jeu », et un choix forgé est ignoré.
  ca.openMenu();
  await until(() => ca.menu?.id === 'sixm:main', 'menu principal');
  assert.ok(!ca.menu.items.some((i) => i.id === 'jeu'));
  ca.selectMenu('jeu', 'v:noclip', true);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(a.values.get('noclip'), undefined);

  srv.access.setAdmin(playerUid(me.publicKey), 'Ana', true);
  ca.openMenu();
  await until(() => ca.menu?.items.some((i) => i.id === 'jeu'), 'Mon jeu pour un admin');
  ca.selectMenu('sixm:main', 'jeu');
  await until(() => page(ca.menu)?.id === 'jeu', 'Mon jeu');
  assert.deepEqual(page(ca.menu).items.slice(0, 2).map((i) => [i.label, i.type]), [['No clip', 'checkbox'], ['Invincible', 'checkbox']]);
  ca.selectMenu('jeu', 'v:noclip', true);
  await until(() => a.values.get('noclip') === 1, 'no clip posé dans le jeu');

  // Aller vers Bob, puis amener Bob ici.
  ca.selectMenu('jeu:tp', String(cb.id));
  await until(() => Math.abs(a.local.x - -98.5) < 1e-9, 'téléporté vers Bob');
  await until(() => view(ca).pos.x === a.local.x, 'position partagée');
  ca.selectMenu('admin:joueur', `bring:${cb.id}`);
  await until(() => Math.abs(b.local.x - (a.local.x + 1.5)) < 1e-9, 'Bob amené');

  // Le jeu de Cid ne permet rien : le serveur ne lui envoie rien.
  ca.selectMenu('admin:joueur', `bring:${cc.id}`);
  await until(() => ca.notices.some((n) => /ne permet pas la téléportation/.test(n.text)), 'refus signalé');
});
