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
    { teleport: false, values: [{ name: 'noclip', type: 'u8' }], scanner: false });
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
  assert.deepEqual(view(cc).game, { teleport: false, values: [], scanner: false });

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

test('recherche mémoire depuis le menu : chercher, affiner, écrire, chemin, profil ; seulement si activée', async (t) => {
  const srv = await createServer({ name: 't', port: 0, tickRate: 50, resourcesDir: 'resources', autostart: ['menu'] });
  const me = createIdentity();
  const a = new MockAdapter();
  const c = new SixMClient({ url: `ws://localhost:${srv.net.port}`, name: 'Ana', adapter: a, identity: me, posIntervalMs: 20 });
  t.after(async () => { await c.disconnect(); await srv.stop(); });
  await c.connect();
  srv.access.setAdmin(playerUid(me.publicKey), 'Ana', true);
  const view = () => [...srv.world.players.values()][0];
  await until(() => view()?.game?.scanner, 'recherche annoncée');
  c.openMenu();
  await until(() => c.menu?.items.some((i) => i.id === 'scan'), 'entrée visible');
  c.selectMenu('sixm:main', 'scan');
  await until(() => page(c.menu)?.id === 'scan', 'menu de recherche');

  c.selectMenu('scan', 'type', 1); // entier
  await until(() => page(c.menu)?.items.find((i) => i.id === 'type')?.value === 1, 'type choisi');
  c.selectMenu('scan', 'new:exact', '200');
  await until(() => /^2 résultat/.test(page(c.menu)?.items.find((i) => i.id === 'statut')?.label), 'deux résultats');
  a.health = 150;
  c.selectMenu('scan', 'next:decreased');
  await until(() => /^1 résultat/.test(page(c.menu)?.items.find((i) => i.id === 'statut')?.label), 'un seul a diminué');
  const hit = page(c.menu).items.find((i) => i.id.startsWith('r:'));
  assert.deepEqual([hit.label, hit.right], ['0x200000040', '150']);

  const addr = hit.id.slice(2);
  c.selectMenu('scan:adresse', `set:${addr}`, '999');
  await until(() => a.health === 999, 'valeur écrite dans le jeu');
  c.selectMenu('scan:adresse', `ptr:${addr}`);
  const scanRoot = () => c.menu?.items.find((i) => i.id === 'scan')?.menu;
  await until(() => scanRoot()?.items.find((i) => i.id === `r:${addr}`)?.menu.items.some((i) => i.id.startsWith('c:')), 'chemin trouvé');
  assert.equal(page(c.menu).id, 'scan:adresse', 'le joueur reste sur l\'adresse');
  c.selectMenu('scan:chemin', `val:${addr}:0`, 'Vie!');
  await until(() => c.notices.some((n) => /un nom en minuscules/.test(n.text)), 'nom refusé');
  c.selectMenu('scan:chemin', `val:${addr}:0`, 'vie');
  await until(() => a.profile.length === 1, 'enregistré dans le profil');
  assert.deepEqual(a.profile[0], { action: 'saveProfile', key: 'value', name: 'vie', type: 'i32', chain: [0x2a3f10, 0x18, 0x40] });
  await until(() => c.notices.some((n) => n.title === 'Profil enregistré'), 'confirmation');

  // Désactivée dans SixM : l'entrée disparaît et le serveur ne peut plus rien demander.
  a.scanner = false;
  await until(() => view().game.scanner === false, 'désactivée');
  c.openMenu();
  await until(() => c.menu?.id === 'sixm:main' && !c.menu.items.some((i) => i.id === 'scan'), 'entrée cachée');
});

test('profil local écrit par la recherche : lignes ajoutées ou remplacées, le reste gardé', async () => {
  const { writeProfile } = await import('../client/module.js');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-prof-'));
  try {
    const file = writeProfile(dir, 'abc-123', { key: 'position', chain: [0x1000, 0x20, 0x90], teleport: true });
    writeProfile(dir, 'abc-123', { key: 'value', name: 'noclip', type: 'u8', chain: [0x3000, 0x18] });
    fs.appendFileSync(file, 'camera = 0x2000 # à la main\n');
    writeProfile(dir, 'abc-123', { key: 'position', chain: [0x1008, 0x20], teleport: false });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.deepEqual(lines, ['build = abc-123', '# Écrit par SixM (recherche mémoire) ; modifiable à la main.', 'position = 0x1008, 0x20', 'teleport = on', 'value.noclip = u8, 0x3000, 0x18', 'camera = 0x2000 # à la main']);
    assert.throws(() => writeProfile(dir, '../x', { key: 'position', chain: [1] }), /version du jeu/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
