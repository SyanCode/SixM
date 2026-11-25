import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, render } from '../scripts/readme.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replaceAll('\r\n', '\n');

test('README : même structure partout, à jour (npm run readme)', () => {
  const shape = (o) => JSON.stringify(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v === 'object' ? Object.keys(v) : typeof v]));
  for (const [code, t] of Object.entries(LANGUAGES)) {
    assert.equal(shape(t), shape(LANGUAGES.en), `traduction incomplète : ${code}`);
    assert.equal(read(t.file), render(code), `${t.file} n'est pas à jour`);
  }
  assert.deepEqual(fs.readdirSync(root).filter((f) => /^README/.test(f)).sort(), Object.values(LANGUAGES).map((t) => t.file).sort());
});

test('README : liens et images locaux existent', () => {
  for (const t of Object.values(LANGUAGES)) {
    const text = read(t.file);
    const targets = [...text.matchAll(/\]\(([^)]+)\)|(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? m[2]).filter((u) => !/^https?:/.test(u));
    assert.ok(targets.length > 10);
    for (const u of targets) assert.ok(fs.existsSync(path.join(root, u)), `${t.file} : ${u}`);
  }
});
