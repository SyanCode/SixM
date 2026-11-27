import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app/server.js';
import { findOptions, portEnv, PORTS } from '../app/ports.js';
import { findSdk } from '../app/sdks.js';

const touch = (...p) => { fs.mkdirSync(path.join(...p.slice(0, -1)), { recursive: true }); fs.writeFileSync(path.join(...p), ''); };

test('DLSS et FidelityFX trouvés seuls : endroits connus, SDK décompressé, casse ignorée', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-sdk-'));
  const home = path.join(t, 'home'), local = path.join(t, 'local'), src = path.join(t, 'src'), exeDir = path.join(t, 'build');
  const ctx = { exeDir, src, localAppData: local, roots: [path.join(home, 'Downloads'), home] };
  try {
    assert.equal(findSdk('streamline', ctx), null, 'rien sur ce PC');
    touch(home, 'Downloads', 'streamline-sdk-v2.14.16', 'bin', 'x64', 'SL.Interposer.dll');
    assert.equal(findSdk('streamline', ctx), path.join(home, 'Downloads', 'streamline-sdk-v2.14.16', 'bin', 'x64'));
    touch(local, 'victory', 'nvidia-sdk', 'Streamline', 'bin', 'x64', 'sl.interposer.dll');
    assert.equal(findSdk('streamline', ctx), path.join(local, 'victory', 'nvidia-sdk', 'Streamline', 'bin', 'x64'), 'celui de « victory get-dlss » d\'abord');

    touch(home, 'FidelityFX-SDK-v2.0', 'Kits', 'FidelityFX', 'signedbin', 'amd_fidelityfx_upscaler_dx12.dll');
    assert.equal(findSdk('fidelityfx', ctx, 'amd_fidelityfx_upscaler_dx12.dll'), path.join(home, 'FidelityFX-SDK-v2.0', 'Kits', 'FidelityFX', 'signedbin'));
    assert.equal(findSdk('fidelityfx', ctx, 'amd_fidelityfx_framegeneration_dx12.dll'), null, 'le bon fichier, pas seulement le dossier');
    touch(exeDir, 'fidelityfx', 'amd_fidelityfx_framegeneration_dx12.dll');
    assert.equal(findSdk('fidelityfx', ctx, 'amd_fidelityfx_framegeneration_dx12.dll'), path.join(exeDir, 'fidelityfx'));

    const nv = PORTS.find((p) => p.id === 'victory-nvidia');
    const found = findOptions(nv, ctx, findSdk);
    assert.deepEqual(Object.keys(found), ['streamline', 'fidelityfx']);
    const env = portEnv(nv, {}, found);
    assert.equal(env.VICTORY_STREAMLINE_DIR, found.streamline);
    assert.equal(env.VICTORY_FIDELITYFX_DIR, path.join(exeDir, 'fidelityfx'));
    assert.equal(portEnv(nv, { streamline: 'D:\\SL' }, found).VICTORY_STREAMLINE_DIR, 'D:\\SL', 'le choix du joueur passe avant');
    assert.equal(portEnv(nv, {}, { streamline: null }).VICTORY_STREAMLINE_DIR, undefined);
  } finally {
    fs.rmSync(t, { recursive: true, force: true });
  }
});

test('API : dossiers trouvés dans l\'état, téléchargement par le portage seulement s\'il sait le faire', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-'));
  const app = await createApp({ dataDir, builderOptions: { supported: false }, sdkFinder: (kind) => (kind === 'streamline' ? 'C:\\SL' : null) });
  const call = async (p, body) => {
    const res = await fetch(app.origin + p, { method: body ? 'POST' : 'GET', body: body && JSON.stringify(body), headers: { 'x-sixm-token': app.token } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    return json;
  };
  try {
    const st = await call('/api/state');
    const nv = st.ports.find((p) => p.id === 'victory-nvidia');
    assert.deepEqual([nv.found, nv.fetch], [{ streamline: 'C:\\SL', fidelityfx: null }, ['streamline']]);
    assert.ok(!nv.options.some((o) => 'find' in o));
    await assert.rejects(call('/api/ports/fetch', { kind: 'streamline' }), /ne sait pas/, 'VIctory choisi : rien à télécharger');
    await call('/api/ports/select', { id: 'victory-nvidia' });
    await assert.rejects(call('/api/ports/fetch', { kind: 'streamline' }), /n'est pas installé/);
    await assert.rejects(call('/api/victory/rebuild', { force: true }), /n'est pas installé/);
  } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
