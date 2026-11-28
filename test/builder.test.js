import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../app/server.js';
import { hideWarnings, isExe, PINNED, VictoryBuilder } from '../app/builder.js';

const skip = process.platform !== 'win32' && 'Windows seulement';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, what, ms = 10000) => {
  const end = Date.now() + ms;
  while (!await cond()) {
    if (Date.now() > end) assert.fail(`délai dépassé : ${what}`);
    await wait(30);
  }
};
const A = 'a'.repeat(40), B = 'b'.repeat(40);

// Faux outils : aucun accès réseau, aucun vrai git ni cargo.
const GIT = `
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE + '/git.log', JSON.stringify(args) + '\\n');
const cmd = args.filter((a, i) => a !== '-c' && args[i - 1] !== '-c');
const mode = fs.readFileSync(process.env.FAKE + '/git.mode', 'utf8');
if (cmd[0] === '--version') console.log('git version 9.9');
else if (cmd[0] === 'ls-remote') console.log(fs.readFileSync(process.env.FAKE + '/latest', 'utf8') + '\\tHEAD');
else if (cmd[0] === 'init') fs.mkdirSync('.git');
else if (cmd[0] === 'fetch') {
  if (mode === 'fail') { console.error('fatal: unable to access'); process.exit(128); }
  process.stderr.write('Receiving objects:  50% (1/2)\\rReceiving objects: 100% (2/2), done.\\n');
  fs.writeFileSync('.git/HEAD', cmd.at(-1));
} else if (cmd[0] === 'checkout') {
  fs.mkdirSync('apps/victory/src', { recursive: true });
  fs.writeFileSync('LICENSE', 'GPL-3');
  fs.writeFileSync('Cargo.lock', '[[package]]\\nname = "a"\\nversion = "1.0.0"\\nchecksum = "x"\\n');
  fs.writeFileSync('apps/victory/Cargo.toml', '[package]\\nname = "victory"\\n\\n[dependencies]\\nanyhow = "1"\\n');
  fs.writeFileSync('apps/victory/src/main.rs', mode === 'nomain' ? 'fn other() {}' : 'fn main() -> Result<()> {\\n    run();\\n}\\n');
}
else if (cmd[0] === 'rev-parse') console.log(mode === 'wrong' ? 'c'.repeat(40) : fs.readFileSync('.git/HEAD', 'utf8'));
`;
const CARGO = `
const fs = require('fs'), path = require('path'), cp = require('child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('cargo 9.9'); process.exit(); }
if (args[0] === 'fetch') process.exit();
if (args[0] === 'update') {
  const m = fs.readFileSync(process.env.FAKE + '/cargo.mode', 'utf8');
  fs.appendFileSync('Cargo.lock', '[[package]]\\nname = "sixm-bridge"\\nversion = "0.1.0"\\n' + (m === 'drift' ? '[[package]]\\nname = "evil"\\nversion = "9.9.9"\\n' : ''));
  process.exit();
}
const F = process.env.FAKE, mode = fs.readFileSync(F + '/cargo.mode', 'utf8');
fs.writeFileSync(F + '/cargo.json', JSON.stringify({ args, cwd: process.cwd(), target: process.env.CARGO_TARGET_DIR, toolchain: process.env.RUSTUP_TOOLCHAIN }));
process.stderr.write('   \\u001b[32mCompiling\\u001b[0m victory v0.1.0\\n');
process.stderr.write('    Building [=====>      ] 5/10: victory\\r');
if (mode === 'hang') {
  const kid = cp.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  fs.writeFileSync(F + '/kid', String(kid.pid));
  setInterval(() => {}, 1000);
} else setTimeout(() => {
  if (mode === 'fail') { console.error('error: could not compile'); process.exit(101); }
  const out = process.env.CARGO_TARGET_DIR + '/release';
  fs.mkdirSync(out, { recursive: true });
  if (mode === 'bad') fs.writeFileSync(out + '/victory.exe', 'MZ pas un programme');
  else if (mode !== 'noexe') fs.copyFileSync(F + '/fake.exe', out + '/victory.exe');
  process.stderr.write('    Building [===========>] 9/10: victory\\r\\n    Finished release\\n');
}, 150);
process.stderr.write(' ');
`;
const WINGET = `
const fs = require('fs');
fs.writeFileSync(process.env.FAKE + '/winget.json', JSON.stringify(process.argv.slice(2)));
if (fs.readFileSync(process.env.FAKE + '/winget.mode', 'utf8') === 'fail') process.exit(7);
fs.writeFileSync(process.env.FAKE + '/has-' + process.argv[4], '');
`;
let exe;
function fakeExe() {
  if (exe) return exe;
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'f.cs'), 'static class P { static int Main(string[] a) { return a.Length == 1 && a[0] == "--help" ? 0 : 9; } }');
  execFileSync(path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), ['/nologo', `/out:${path.join(dir, 'fake.exe')}`, path.join(dir, 'f.cs')]);
  return exe = path.join(dir, 'fake.exe');
}

function setup(extra = {}) {
  const fake = tmp(), dir = path.join(tmp(), 'victory été');
  const put = (name, text) => fs.writeFileSync(path.join(fake, name), text);
  for (const [n, s] of [['git.cjs', GIT], ['cargo.cjs', CARGO], ['winget.cjs', WINGET]]) put(n, s);
  put('git.mode', ''); put('cargo.mode', ''); put('winget.mode', ''); put('latest', B);
  fs.copyFileSync(fakeExe(), path.join(fake, 'fake.exe'));
  process.env.FAKE = fake;
  const node = (f) => () => [process.execPath, path.join(fake, f)];
  const tools = {
    git: node('git.cjs'), cargo: node('cargo.cjs'), rustup: node('cargo.cjs'), winget: node('winget.cjs'),
    vswhere: () => [process.execPath, '-e', 'console.log("17.14.1")', '--'], sdk: () => true, freeBytes: () => 100 * 2 ** 30, ...extra,
  };
  const done = [];
  const b = new VictoryBuilder(dir, { tools, pinned: A, onInstalled: (f) => done.push(f) });
  const read = (name) => JSON.parse(fs.readFileSync(path.join(fake, name), 'utf8'));
  const gits = () => (fs.existsSync(path.join(fake, 'git.log')) ? fs.readFileSync(path.join(fake, 'git.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { b, dir, fake, put, read, done, gits, tools };
}

test('le commit épinglé est complet', () => assert.match(PINNED, /^[0-9a-f]{40}$/));

test('isExe : vrai programme seulement', () => {
  const dir = tmp(), f = (n, t) => { fs.writeFileSync(path.join(dir, n), t); return path.join(dir, n); };
  assert.equal(isExe(f('a.exe', 'MZ…')), true);
  for (const bad of [f('b.exe', 'ZZ'), f('c.exe', ''), f('d.txt', 'MZ'), path.join(dir, 'absent.exe'), 'a.exe', '', null, dir]) assert.equal(isExe(bad), false, String(bad));
});

test('installation : clone épinglé, cargo --locked, chemin renseigné, sans recompiler ensuite', { skip }, async () => {
  process.env.RUSTUP_TOOLCHAIN = 'nightly';
  const { b, dir, done, read, gits, put } = setup();
  const seen = [];
  const timer = setInterval(() => { if (b.step === 'Compilation') seen.push(b.progress); }, 20);
  await b.install();
  clearInterval(timer);
  delete process.env.RUSTUP_TOOLCHAIN;
  assert.deepEqual([b.status, b.error], ['done', null]);
  const out = path.join(dir, 'builds', `${A.slice(0, 12)}-${b.module.id.slice(0, 6)}`, 'victory.exe');
  assert.deepEqual(done, [out]);
  assert.equal(b.installed().commit, A);
  assert.ok(fs.existsSync(path.join(path.dirname(out), 'LICENSE')), 'la licence accompagne le binaire');
  const src = (f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
  assert.match(src('apps/victory/Cargo.toml'), /\[dependencies\]\nsixm-bridge = /);
  assert.match(src('apps/victory/src/main.rs'), /fn main\(\) -> Result<\(\)> \{\n {4}sixm_bridge::start\(\);\n {4}run/);
  assert.ok(src('crates/sixm-bridge/src/lib.rs').includes('pub fn start()'));
  assert.equal(b.moduleStale(), false);
  const cargo = read('cargo.json');
  assert.deepEqual(cargo.args, ['build', '--release', '-p', 'victory', '--locked']);
  assert.equal(cargo.cwd, path.join(dir, 'src'));
  assert.equal(cargo.target, path.join(dir, 'target'));
  assert.equal(cargo.toolchain, undefined, 'la version de Rust épinglée par VIctory est respectée');
  const fetch = gits().find((g) => g.includes('fetch'));
  assert.deepEqual(fetch.slice(-2), ['https://github.com/Marvisak/VIctory.git', A]);
  assert.ok(fetch.includes('protocol.file.allow=never'));
  assert.ok(seen.includes(0.5), `progression lue : ${seen}`);
  assert.ok(b.log.some((l) => l === '   Compiling victory v0.1.0'), 'couleurs retirées');
  assert.ok(!b.log.some((l) => l.includes('Building [')), 'barres hors du journal');
  assert.ok(fs.readFileSync(b.logFile, 'utf8').includes('Finished release'));

  put('cargo.mode', 'fail');
  await b.install();
  assert.equal(b.status, 'done', 'même commit : rien à recompiler');
});

test('une compilation ratée ne remplace pas le VIctory qui marche', { skip }, async () => {
  const { b, put, done } = setup();
  await b.install();
  const good = b.installed();
  for (const [mode, message] of [['fail', /a échoué \(code 101\)/], ['noexe', /n'a pas produit/], ['bad', /a échoué/]]) {
    put('cargo.mode', mode);
    await b.update();
    assert.equal(b.status, 'failed', mode);
    assert.match(b.error, message);
    assert.deepEqual(b.installed(), good, mode);
    assert.ok(isExe(good.exe));
  }
  put('cargo.mode', 'drift');
  await b.update();
  assert.match(b.error, /dépendances de VIctory ont bougé/);
  put('cargo.mode', '');
  put('git.mode', 'nomain');
  await b.update();
  assert.match(b.error, /main\.rs ne se laisse plus compléter/);
  assert.deepEqual(b.installed(), good);
  for (const mode of ['fail', 'wrong']) {
    put('git.mode', mode);
    await b.update();
    assert.equal(b.status, 'failed', `git ${mode}`);
    assert.deepEqual(b.installed(), good);
  }
  assert.equal(done.length, 1);
  put('git.mode', ''); put('cargo.mode', '');
  await b.update();
  assert.deepEqual([b.status, b.installed().commit, done.length], ['done', B, 2]);
  assert.ok(isExe(good.exe), 'l\'ancienne version reste sur le disque');
});

test('annulation : tout l\'arbre de processus est arrêté, rien n\'est installé', { skip }, async () => {
  const { b, put, fake, done } = setup();
  put('cargo.mode', 'hang');
  const run = b.install();
  assert.throws(() => b.install(), /déjà en cours/);
  assert.throws(() => b.installTool('git'), /déjà en cours/);
  await until(() => fs.existsSync(path.join(fake, 'kid')) && fs.readFileSync(path.join(fake, 'kid'), 'utf8'), 'cargo lancé');
  const kid = Number(fs.readFileSync(path.join(fake, 'kid'), 'utf8'));
  b.cancel();
  await run;
  assert.deepEqual([b.status, b.error, b.installed(), done.length], ['cancelled', null, null, 0]);
  await until(() => { try { process.kill(kid, 0); return false; } catch { return true; } }, 'sous-processus arrêté');
  put('cargo.mode', '');
  await b.install();
  assert.equal(b.status, 'done', 'reprise après annulation');
});

test('prérequis : ce qui manque est nommé et bloque avant tout téléchargement', { skip }, async () => {
  const none = { git: () => null, cargo: () => null, rustup: () => null, vswhere: () => null, freeBytes: () => 2 ** 30 };
  const { b, gits } = setup(none);
  assert.deepEqual((await b.check()).map((c) => [c.id, c.ok]), [['git', false], ['rust', false], ['msvc', false], ['disk', false]]);
  await b.install();
  assert.equal(b.error, 'il manque : Git, Rust, Outils C++ (MSVC), Espace disque');
  assert.equal(gits().length, 0);
  const sdk = setup({ sdk: () => false });
  assert.equal((await sdk.b.check())[2].detail, 'SDK Windows manquant');
  const bare = setup({ rustup: () => null });
  assert.equal((await bare.b.check())[1].detail, 'cargo sans rustup');
  const broken = setup({ git: () => [process.execPath, '-e', 'process.exit(3)', '--'] });
  assert.equal((await broken.b.check())[0].detail, 'ne répond pas');
});

test('winget : un paquet précis par élément, échec signalé', { skip }, async () => {
  const ctx = setup();
  const has = (id) => fs.existsSync(path.join(ctx.fake, `has-${id}`));
  ctx.b.tools.rustup = () => (has('Rustlang.Rustup') ? ctx.tools.rustup() : null);
  await ctx.b.installTool('rust');
  assert.deepEqual([ctx.b.status, ctx.b.error], ['done', null]);
  assert.deepEqual(ctx.read('winget.json').slice(0, 4), ['install', '--id', 'Rustlang.Rustup', '-e']);
  await ctx.b.installTool('msvc');
  assert.ok(ctx.read('winget.json').includes('Microsoft.VisualStudio.2022.BuildTools'));
  for (const bad of ['disk', 'constructor', '', null, 'x; calc']) assert.throws(() => ctx.b.installTool(bad), /élément inconnu/);
  ctx.put('winget.mode', 'fail');
  await ctx.b.installTool('git');
  assert.match(ctx.b.error, /a échoué \(code 7\)/);
  ctx.b.tools.winget = () => null;
  assert.throws(() => ctx.b.installTool('git'), /winget est introuvable/);
});

test('dépôt qui répond n\'importe quoi ; système non pris en charge', { skip }, async () => {
  const { b, put } = setup();
  put('latest', 'HEAD --upload-pack=calc');
  await assert.rejects(b.latest(), /ne répond pas/);
  await b.update();
  assert.equal(b.status, 'failed');
  assert.throws(() => new VictoryBuilder(tmp(), { supported: false }).install(), /demande Windows/);
});

test('application : rien ne se lance seul, installation, mise à jour manuelle, reprise', { skip }, async () => {
  const { tools, put, gits } = setup();
  const dataDir = tmp();
  const open = async () => {
    const app = await createApp({ dataDir, builderOptions: { tools, pinned: A } });
    const call = async (p, body) => {
      const res = await fetch(app.origin + p, { method: body ? 'POST' : 'GET', body: body && JSON.stringify(body), headers: { 'x-sixm-token': app.token } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return json;
    };
    return { app, call, v: async () => (await call('/api/state')).victory };
  };
  let { app, call, v } = await open();
  await until(async () => (await v()).checks, 'contrôle au démarrage');
  assert.deepEqual([(await v()).valid, (await v()).status, (await v()).installed], [false, 'idle', null]);
  assert.equal(gits().filter((g) => g.includes('fetch')).length, 0, 'aucun téléchargement sans clic');

  await call('/api/victory/install', {});
  await assert.rejects(call('/api/victory/install', {}), /déjà en cours/);
  await until(async () => (await v()).status === 'done', 'installation');
  assert.equal((await v()).valid, true);
  assert.equal((await call('/api/state')).settings.victory, (await v()).installed.exe);
  assert.equal((await call('/api/victory/latest', {})).commit, B);
  assert.equal((await v()).installed.commit, A, 'consulter la dernière version n\'installe rien');
  await app.close();

  // Réglage perdu : la version déjà compilée est reprise, sans recompiler.
  fs.rmSync(path.join(dataDir, 'settings.json'));
  put('cargo.mode', 'fail');
  ({ app, call, v } = await open());
  assert.deepEqual([(await v()).valid, (await v()).status], [true, 'idle']);

  put('cargo.mode', 'hang');
  await call('/api/victory/update', {});
  await until(async () => (await v()).step === 'Compilation', 'compilation');
  assert.equal(app.idleFor(-1), false, 'une compilation en cours garde SixM ouvert');
  await call('/api/victory/cancel', {});
  await until(async () => (await v()).status === 'cancelled', 'annulation');
  assert.equal((await v()).installed.commit, A);
  assert.equal(app.idleFor(-1), true);

  await call('/api/victory/update', {});
  await until(async () => (await v()).step === 'Compilation', 'seconde compilation');
  await app.close(); // fermer SixM arrête la compilation
  assert.equal(app.victory.status, 'cancelled');
});

test('module changé : recompilation de la même version, un seul essai automatique', { skip }, async () => {
  const { b, dir, put } = setup();
  await b.install();
  assert.equal(b.autoRebuild(), false, 'rien à faire');
  b.module = { ...b.module, id: 'f'.repeat(12) };
  assert.equal(b.moduleStale(), true);
  put('cargo.mode', 'fail');
  assert.equal(b.autoRebuild(), true);
  await b.running;
  assert.deepEqual([b.status, b.task, b.moduleStale()], ['failed', 'rebuild', true]);
  assert.equal(b.autoRebuild(), false, 'pas d\'essai à chaque lancement');
  put('cargo.mode', '');
  await b.rebuild();
  assert.deepEqual([b.status, b.installed().commit, b.moduleStale()], ['done', A, false]);
  assert.ok(b.installed().exe.includes('-ffffff'));
  assert.ok(b.installed().exe.startsWith(path.join(dir, 'builds')));
});

test('journal à copier : en-tête de diagnostic, journal complet, dossier personnel masqué', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-'));
  const b = new VictoryBuilder(dir, { name: 'Fork', repo: 'https://github.com/a/b.git', pinned: null, supported: false });
  assert.match(b.report(), /Portage : Fork \(https:\/\/github\.com\/a\/b\.git\), commit dernier publié[\s\S]*\(journal vide\)/);
  const lines = Array.from({ length: 1000 }, (_, i) => `ligne ${i}`);
  fs.writeFileSync(b.logFile, `${lines.join('\n')}\nerror: ${path.join(os.homedir(), 'x', 'Cargo.toml')}\n`);
  const text = b.report();
  assert.match(text, /^SixM \d+\.\d+\.\d+, /);
  assert.ok(text.includes('ligne 0\n') && text.includes('ligne 999\n'), 'tout le journal, pas seulement l\'écran');
  assert.ok(!text.includes(os.homedir()) && text.includes(`error: ${path.join('~', 'x', 'Cargo.toml')}`));

  const app = await createApp({ dataDir: dir, builderOptions: { supported: false } });
  try {
    const res = await fetch(`${app.origin}/api/victory/log`, { headers: { 'x-sixm-token': app.token } });
    assert.match((await res.json()).text, /^SixM .*\nPortage : VIctory/);
    assert.equal((await fetch(`${app.origin}/api/victory/log`)).status, 401, 'jeton exigé');
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('journal : avertissements du code du portage masqués, erreurs gardées', () => {
  const f = hideWarnings();
  const out = [
    '   Compiling victory-gpu v0.1.0 (~\\src\\crates\\victory-gpu)',
    'warning: variant `Title` is never constructed', '    --> crates\\victory-gpu\\src\\host.rs:8597:5', '     |',
    '8591 | enum Touch {', '     |      ----- variant in this enum', '...', '8597 |     Title,', '     |     ^^^^^',
    '     = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default',
    'warning: calls to `std::mem::drop` with a value that implements `Copy` does nothing', '  --> crates\\x.rs:64:48', '   |',
    '   Compiling victory-hle v0.1.0 (~\\src\\crates\\victory-hle)',
    'warning: `victory-gpu` (lib) generated 12 warnings',
    'error[E0425]: cannot find value `x` in this scope', '  --> src\\main.rs:2:5', '   |',
    '    Finished `release` profile [optimized + debuginfo] target(s) in 1m 04s',
  ].map(f).filter((l) => l !== null);
  assert.deepEqual(out, [
    '   Compiling victory-gpu v0.1.0 (~\\src\\crates\\victory-gpu)',
    '   Compiling victory-hle v0.1.0 (~\\src\\crates\\victory-hle)',
    '   victory-gpu : 12 avertissement(s) du code du portage, masqué(s)',
    'error[E0425]: cannot find value `x` in this scope', '  --> src\\main.rs:2:5', '   |',
    '    Finished `release` profile [optimized + debuginfo] target(s) in 1m 04s',
  ]);
});
