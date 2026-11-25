import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compareVersions, Updater } from '../app/updater.js';
import { createApp } from '../app/server.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const setup = Buffer.from('MZ faux installateur');

/** Arborescence d'un SixM installé ou portable. */
function tree(kind, version = '0.2.0') {
  const top = tmp(), root = path.join(top, 'app');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  fs.mkdirSync(path.join(top, 'node'));
  for (const f of ['SixM.exe', 'node/node.exe', ...(kind === 'installed' ? ['sixm-install.txt'] : [])]) fs.writeFileSync(path.join(top, f), '');
  return { top, root };
}
function release(tag = 'v0.3.0', over = {}) {
  const v = tag.replace(/^v/, ''), name = `SixM-Setup-${v}.exe`;
  return { tag_name: tag, assets: [{ name, browser_download_url: `https://github.com/SyanCode/SixM/releases/download/v${v}/${name}`, digest: `sha256:${sha(setup)}`, ...over }] };
}
const fakeFetch = (rel, body = setup) => async (url) => (url.startsWith('https://api.github.com/') ? new Response(JSON.stringify(rel)) : new Response(body));

test('versions : jamais de retour en arrière', () => {
  for (const [a, b, r] of [['0.3.0', '0.2.9', 1], ['v1.0.0', '0.9.9', 1], ['0.10.0', '0.9.0', 1], ['0.2.0', '0.2.0', 0], ['0.1.9', '0.2.0', -1], ['latest', '0.2.0', 0], ['0.3.0-beta', '0.2.0', 0], ['', '0.2.0', 0]])
    assert.equal(compareVersions(a, b), r, `${a} ${b}`);
});

test('installé : télécharge, vérifie, lance l\'installateur', async () => {
  const { top, root } = tree('installed'), dir = tmp(), started = [];
  let restarted = 0;
  const u = new Updater(dir, { root, fetch: fakeFetch(release()), start: async (f, a) => started.push([f, a, fs.readFileSync(f)]), onRestart: () => restarted++ });
  assert.equal(u.mode, 'installed');
  assert.equal(await u.check(), true);
  assert.deepEqual([u.status, u.latest, fs.existsSync(path.join(dir, 'updates'))], ['available', '0.3.0', false]);
  assert.equal(await u.apply(), true);
  assert.deepEqual([u.status, restarted, started.length], ['restarting', 1, 1]);
  assert.equal(path.basename(started[0][0]), 'SixM-Setup-0.3.0.exe');
  assert.deepEqual(started[0][1], ['--silent', '--no-shortcuts', '--dir', top]);
  assert.ok(started[0][2].equals(setup));
});

test('installé : empreinte fausse, adresse étrangère, version ancienne ou préliminaire refusées', async () => {
  const dir = tmp(), started = [];
  const make = (rel, body) => new Updater(dir, { root: tree('installed').root, fetch: fakeFetch(rel, body), start: async (f) => started.push(f) });
  const bad = make(release(), Buffer.from('MZ piégé'));
  await bad.check();
  assert.equal(await bad.apply(), false);
  assert.match(bad.error, /empreinte/);
  assert.equal(fs.existsSync(path.join(dir, 'updates')), false, 'rien écrit avant vérification');
  for (const over of [{ browser_download_url: 'https://mal.example/SixM-Setup-0.3.0.exe' }, { digest: null }, { digest: 'sha256:abc' }, { name: 'autre.exe' }]) {
    const u = make(release('v0.3.0', over));
    assert.equal(await u.check(), false);
    assert.equal(u.status, 'failed', JSON.stringify(over));
  }
  for (const rel of [release('v0.2.0'), release('v0.1.0'), release('v../../x'), { ...release(), prerelease: true }, { ...release(), draft: true }]) {
    const u = make(rel);
    assert.equal(await u.check(), false);
    assert.equal(u.status, 'current');
  }
  assert.equal(started.length, 0);
});

test('jamais pendant une partie ; portable : signale seulement', async () => {
  let free = false;
  const started = [];
  const u = new Updater(tmp(), { root: tree('installed').root, fetch: fakeFetch(release()), start: async (f) => started.push(f), canApply: () => free });
  await u.check();
  assert.equal(await u.apply(), false);
  assert.equal(u.status, 'available', 'gardée pour plus tard');
  free = true;
  assert.equal(await u.apply(), true);
  const p = new Updater(tmp(), { root: tree('portable').root, fetch: fakeFetch(release()), start: async (f) => started.push(f) });
  assert.equal(await p.check(), true);
  assert.equal(await p.apply(), false);
  assert.deepEqual([p.mode, p.status, started.length], ['portable', 'available', 1]);
});

test('source : avance rapide réelle de git, dossier modifié ou branche respectés', async () => {
  const base = tmp(), origin = path.join(base, 'origin'), work = path.join(base, 'work');
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd, stdio: 'pipe' }).toString().trim();
  fs.mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  const commit = (text) => { fs.writeFileSync(path.join(origin, 'package.json'), JSON.stringify({ version: '0.2.0', text })); git(origin, 'add', '-A'); git(origin, 'commit', '-q', '-m', text); };
  commit('un');
  git(base, 'clone', '-q', origin, work);
  let restarted = 0;
  // Dépôt local pour le test ; seule l'adresse affichée est la vraie.
  const exec = async (cmd, args, cwd) => (args[0] === 'remote' ? 'https://github.com/SyanCode/SixM.git' : git(cwd, ...args));
  const make = () => new Updater(tmp(), { root: work, exec, onRestart: () => restarted++ });
  assert.equal(make().mode, 'source');
  assert.equal(await make().check(), false, 'à jour');
  commit('deux');
  fs.writeFileSync(path.join(work, 'perso.txt'), 'x');
  let u = make();
  assert.equal(await u.check(), true);
  assert.equal(await u.apply(), false);
  assert.match(u.error, /modifiés ici/);
  fs.rmSync(path.join(work, 'perso.txt'));
  u = make();
  await u.check();
  assert.equal(await u.apply(), true);
  assert.deepEqual([JSON.parse(fs.readFileSync(path.join(work, 'package.json'))).text, restarted], ['deux', 1]);
  commit('trois');
  git(work, 'checkout', '-q', '-b', 'essai');
  assert.equal(await make().check(), false, 'une branche de travail n\'est pas touchée');
  git(work, 'checkout', '-q', 'main');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'local');
  assert.equal(await make().check(), false, 'historique divergent non fusionné');
  const foreign = new Updater(tmp(), { root: work, exec: async () => 'https://github.com/autre/SixM.git' });
  assert.equal(await foreign.check(), false);
  assert.match(foreign.error, /ne suit pas/);
});

test('application : mise à jour automatique au lancement, désactivable', async () => {
  const run = async (autoUpdate, setting) => {
    const dataDir = tmp();
    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ autoUpdate: setting }));
    let restarted = 0;
    const app = await createApp({ dataDir, autoUpdate, onRestart: () => restarted++, builderOptions: { supported: false }, updaterOptions: { root: tree('installed').root, fetch: fakeFetch(release()), start: async () => {} } });
    for (let i = 0; i < 60 && !restarted && autoUpdate && setting !== false; i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 60));
    const { status } = app.updater;
    await app.close();
    return [restarted, status];
  };
  assert.deepEqual(await run(true, undefined), [1, 'restarting']);
  assert.deepEqual(await run(true, false), [0, 'idle']);
  assert.deepEqual(await run(false, true), [0, 'idle']);
});
