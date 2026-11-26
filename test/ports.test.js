import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server.js';
import { Settings } from '../app/settings.js';
import { cleanOptions, customPort, isRepo, portEnv, PORTS } from '../app/ports.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-'));

test('catalogue : ids uniques, commits épinglés, dépôts GitHub', () => {
  assert.deepEqual(PORTS.map((p) => p.id), ['victory', 'belobug-amd']);
  for (const p of PORTS) {
    assert.match(p.pinned, /^[0-9a-f]{40}$/, p.id);
    assert.ok(isRepo(p.repo), p.repo);
    for (const o of p.options) assert.ok(['bool', 'choice', 'path'].includes(o.type), `${p.id}.${o.id}`);
  }
  assert.ok(!isRepo('https://evil.example/x/y') && !isRepo('https://github.com/a') && !isRepo('git@github.com:a/b.git'));
});

test('options de lancement : variables d\'environnement du portage', () => {
  const amd = PORTS.find((p) => p.id === 'belobug-amd');
  const base = portEnv(amd, {});
  assert.equal(base.VICTORY_RELAY, '2', 'réglages du fork');
  assert.equal(base.VICTORY_THIN, '1', 'mode rapide par défaut');
  assert.equal(base.VICTORY_FSR_4K, undefined);
  const safe = portEnv(amd, { safe: true, rayTracing: true, fsr4k: 'balanced', fidelityfx: 'C:\\FSR', bogus: 1 });
  assert.equal(safe.VICTORY_THIN, undefined);
  assert.deepEqual([safe.VICTORY_UNDER_WIDE, safe.VICTORY_BVH_BUILDER, safe.VICTORY_FSR_4K, safe.VICTORY_FIDELITYFX_DIR], ['0', '1', 'balanced', 'C:\\FSR']);
  assert.deepEqual(cleanOptions(amd, { fsr4k: 'ultra', safe: 'oui' }), { safe: false, rayTracing: false, unlock: false, fsr4k: '', fidelityfx: '' });
  assert.deepEqual(portEnv(PORTS[0], { safe: true }), {}, 'VIctory : aucune option');
  assert.equal(customPort({ repo: 'https://github.com/a/b', commit: 'x' }).pinned, null, 'sans commit : le dernier publié');
});

test('réglages : portage, options et dépôt au choix nettoyés', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    port: 'inconnu', portOptions: { 'belobug-amd': { safe: true, x: { y: 1 }, 'a b': 1 }, autre: { z: 1 } },
    customPort: { repo: 'https://exemple.com/a/b', commit: 'abc' },
  }));
  const s = new Settings(dir).value;
  assert.equal(s.port, 'victory');
  assert.deepEqual(s.portOptions, { 'belobug-amd': { safe: true } });
  assert.deepEqual(s.customPort, { repo: '', commit: '' });
  fs.rmSync(dir, { recursive: true });
});

test('API : choisir un portage, ses options, un dépôt au choix', async () => {
  const dataDir = tmp();
  const app = await createApp({ dataDir, builderOptions: { supported: true } });
  const call = async (p, body) => {
    const res = await fetch(app.origin + p, { method: body ? 'POST' : 'GET', body: body && JSON.stringify(body), headers: { 'x-sixm-token': app.token } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    return json;
  };
  try {
    let st = await call('/api/state');
    assert.deepEqual(st.ports.map((p) => p.id), ['victory', 'belobug-amd', 'custom']);
    assert.equal(st.victory.name, 'VIctory');
    assert.ok(!JSON.stringify(st.ports).includes('VICTORY_'), 'les variables ne vont pas à l\'interface');

    await call('/api/ports/select', { id: 'belobug-amd' });
    st = await call('/api/state');
    assert.deepEqual([st.settings.port, st.victory.name, st.victory.repo], ['belobug-amd', 'VIctory Belobug AMD', 'https://github.com/Belobug/VIctory-Belobug-AMD.git']);
    assert.equal(st.settings.victory, '', 'pas encore installé : aucun programme à lancer');
    await assert.rejects(call('/api/ports/select', { id: 'x' }), /inconnu/);

    await call('/api/ports/options', { id: 'belobug-amd', values: { fsr4k: 'quality', rayTracing: true } });
    st = await call('/api/state');
    assert.deepEqual(st.ports.find((p) => p.id === 'belobug-amd').values, { safe: false, rayTracing: true, unlock: false, fsr4k: 'quality', fidelityfx: '' });

    await call('/api/ports/select', { id: 'custom' });
    await assert.rejects(call('/api/victory/install', {}), /indiquez d'abord le dépôt/);
    await assert.rejects(call('/api/ports/custom', { repo: 'https://exemple.com/a/b' }), /adresse attendue/);
    await assert.rejects(call('/api/ports/custom', { repo: 'https://github.com/a/b', commit: 'main' }), /commit attendu/);
    await call('/api/ports/custom', { repo: 'https://github.com/DexNom/VIctory/', commit: '' });
    st = await call('/api/state');
    const custom = st.ports.find((p) => p.id === 'custom');
    assert.deepEqual([custom.repo, custom.pinned, st.victory.name], ['https://github.com/DexNom/VIctory', null, 'Autre portage']);
  } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
