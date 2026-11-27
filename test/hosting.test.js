import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { envOverrides, loadConfig } from '../server/config.js';

test('hébergé (Mas, Docker) : réglages par variables d\'environnement', () => {
  assert.deepEqual(envOverrides({}), {});
  assert.deepEqual(envOverrides({ PORT: '7107', HOST: '127.0.0.1' }), { port: 7107, host: '127.0.0.1' }, 'port et adresse de la plateforme');
  assert.equal(envOverrides({ PORT: '7107', SIXM_PORT: '30120' }).port, 30120, 'SIXM_PORT d\'abord');
  assert.deepEqual(envOverrides({ SIXM_NAME: 'Chez moi', SIXM_TRUST_PROXY: '1', SIXM_WHITELIST: 'oui', SIXM_MAX_PLAYERS: '10', SIXM_VISIBILITY: 'private', SIXM_PASSWORD: '' }),
    { name: 'Chez moi', trustProxy: true, whitelist: true, maxPlayers: 10, visibility: 'private', password: '' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-'));
  try {
    fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify({ name: 'Fichier', port: 30120 }));
    const data = path.join(dir, 'garde', 'data');
    const c = loadConfig(dir, { PORT: '7107', HOST: '127.0.0.1', SIXM_TRUST_PROXY: '1', SIXM_DATA_DIR: data });
    assert.deepEqual([c.name, c.port, c.host, c.trustProxy], ['Fichier', 7107, '127.0.0.1', true]);
    assert.deepEqual([c.bansFile, c.accessFile], [path.join(data, 'bans.json'), path.join(data, 'access.json')]);
    assert.ok(fs.statSync(data).isDirectory(), 'dossier créé');
    assert.equal(loadConfig(dir, {}).bansFile, path.join(dir, 'bans.json'), 'sans variable : comme avant');
    assert.throws(() => loadConfig(dir, { SIXM_MAX_PLAYERS: 'beaucoup' }), /maxPlayers/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
