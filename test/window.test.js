import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeUi } from '../app/window.js';

const exe = process.platform === 'win32' ? 'sixm-ui.exe' : 'sixm-ui';

test('interface native : installée, compilée, choisie ou écartée', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-'));
  try {
    assert.equal(nativeUi({}, dir), null, 'rien de compilé : interface web');
    const built = path.join(dir, 'desktop', 'target', 'release', exe);
    fs.mkdirSync(path.dirname(built), { recursive: true });
    fs.writeFileSync(built, '');
    assert.equal(nativeUi({}, dir), built);
    const shipped = path.join(dir, 'desktop', exe);
    fs.writeFileSync(shipped, '');
    assert.equal(nativeUi({}, dir), shipped, 'la version installée passe avant celle compilée');
    const custom = path.join(dir, 'autre');
    fs.writeFileSync(custom, '');
    assert.equal(nativeUi({ SIXM_UI_BIN: custom }, dir), custom);
    assert.equal(nativeUi({ SIXM_UI_BIN: path.join(dir, 'absent') }, dir), shipped, 'chemin absent : ignoré');
    assert.equal(nativeUi({ SIXM_WEB_UI: '1' }, dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
