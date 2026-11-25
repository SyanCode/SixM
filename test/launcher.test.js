import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../app/server.js';
import { findVictory, Launcher, resolveGame, workingDir } from '../app/launcher.js';
import { buildLink, startLink } from '../client/link.js';
import { SixMClient } from '../client/client.js';
import { MockAdapter } from '../client/adapters/mock.js';
import { VictoryAdapter } from '../client/adapters/victory.js';
import { createServer } from '../server/index.js';

const skip = process.platform !== 'win32' && 'Windows seulement';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sixm-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, what, ms = 8000) => {
  const end = Date.now() + ms;
  while (!await cond()) {
    if (Date.now() > end) assert.fail(`délai dépassé : ${what}`);
    await wait(30);
  }
};

// Faux VIctory : note ses arguments, ouvre une fenêtre, s'arrête sur demande. Aucun jeu n'est utilisé.
const FAKE = `
using System; using System.IO; using System.Windows.Forms;
static class P {
  [STAThread] static int Main(string[] a) {
    File.WriteAllLines("args.txt", a);
    Console.WriteLine("\\u001b[32mdemarrage\\u001b[0m");
    if (a[1].Contains("crash")) return 5;
    Form f = new Form(); f.Text = "Faux VIctory"; f.Width = 640; f.Height = 560;
    Timer t = new Timer(); t.Interval = 100; int n = 0;
    t.Tick += delegate { if (File.Exists("quit.txt") || ++n > 300) f.Close(); };
    t.Start(); Application.Run(f); return 0;
  }
}`;
let shared;
async function tools() {
  shared ??= (async () => {
    const dir = tmp();
    await buildLink(path.join(dir, 'link'));
    fs.writeFileSync(path.join(dir, 'fake.cs'), FAKE);
    execFileSync(path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
      ['/nologo', '/codepage:65001', `/out:${path.join(dir, 'fake.exe')}`, path.join(dir, 'fake.cs')]);
    return dir;
  })();
  return shared;
}
/** Dossier VIctory isolé, avec un nom d'exe unique pour ne jamais croiser un vrai VIctory. */
async function install() {
  const dir = tmp();
  const victory = path.join(dir, 'target', 'release', `faux-victory-${process.pid}-${path.basename(dir)}.exe`);
  fs.mkdirSync(path.dirname(victory), { recursive: true });
  fs.copyFileSync(path.join(await tools(), 'fake.exe'), victory);
  fs.writeFileSync(path.join(dir, '.victory-root'), '');
  const exe = path.join(dir, 'jeu été', 'Jeu.exe');
  fs.mkdirSync(path.dirname(exe));
  fs.writeFileSync(exe, '');
  return { dir, victory, exe, quit: () => fs.writeFileSync(path.join(dir, 'quit.txt'), '') };
}

test('launcher : chemins vérifiés avant tout lancement', () => {
  const l = new Launcher(tmp());
  for (const bad of ['', 'victory.exe', 'C:\\absent\\victory.exe', 'C:\\Windows\\win.ini', null])
    assert.throws(() => l.launch(bad, { path: 'x' }), /VIctory/);
  assert.equal(l.state().status, 'stopped');
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  assert.equal(workingDir(path.join(dir, 'a', 'b', 'v.exe')), path.join(dir, 'a', 'b'));
  fs.writeFileSync(path.join(dir, 'victory.toml'), '');
  assert.equal(workingDir(path.join(dir, 'a', 'b', 'v.exe')), dir);
});

test('launcher : programme trouvé dans le dossier extrait', () => {
  const dir = tmp();
  const put = (name, text = '') => fs.writeFileSync(path.join(dir, name), text);
  const manifest = (...names) => put('MicrosoftGame.Config', `<Game><ExecutableList>${names.map((n) => `<Executable Name="${n}" Id="Game"/>`).join('')}</ExecutableList></Game>`);
  assert.throws(() => resolveGame(dir), /Aucun programme/);
  put('Unique.exe');
  assert.equal(resolveGame(dir), path.join(dir, 'Unique.exe'));
  assert.equal(resolveGame(path.join(dir, 'Unique.exe')), path.join(dir, 'Unique.exe'));
  put('Autre.exe');
  assert.throws(() => resolveGame(dir), /Plusieurs programmes/);
  manifest('jeu.EXE');
  assert.throws(() => resolveGame(dir), /incomplet : jeu.EXE manque/);
  put('Jeu.exe');
  assert.equal(resolveGame(dir), path.join(dir, 'Jeu.exe'));
  manifest('..\\..\\Windows\\notepad.exe', 'C:\\Windows\\notepad.exe', 'sous/x.exe', 'Autre.exe');
  assert.equal(resolveGame(dir), path.join(dir, 'Autre.exe'), 'chemins hors du dossier ignorés');
  put('MicrosoftGame.Config', '<!-- <Executable Name="Unique.exe"/> --><Executable Id="a" Name="Jeu.exe"/>');
  assert.equal(resolveGame(dir), path.join(dir, 'Jeu.exe'));
  put('disque.iso');
  assert.throws(() => resolveGame(path.join(dir, 'disque.iso')), /image de disque/);
  for (const bad of ['', null, 'relatif', path.join(dir, 'absent')]) assert.throws(() => resolveGame(bad), /Le jeu/);
});

test('launcher : arguments, journal, arrêt, plantage, recherche', { skip }, async () => {
  const { dir, victory, exe, quit } = await install();
  const exits = [];
  const l = new Launcher(path.join(dir, 'logs'), { onExit: (e) => exits.push(e) });
  l.launch(victory, { id: 'a', name: 'Jeu', path: exe, console: 'series-s' });
  assert.throws(() => l.launch(victory, { path: exe }), /déjà lancé/);
  await until(() => fs.existsSync(path.join(dir, 'args.txt')), 'lancement');
  await until(() => l.state().log.length, 'journal');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'args.txt'), 'utf8').trim().split(/\r?\n/), ['run', exe, '--execute', '--console', 'series-s']);
  assert.deepEqual(l.state().log, ['demarrage']);
  assert.equal(await findVictory(victory), l.pid);
  assert.equal(await findVictory('C:\\absent-sixm.exe'), 0);
  l.stop();
  await until(() => exits.length === 1, 'arrêt demandé');
  assert.deepEqual([exits[0], l.state().status], [null, 'stopped']);

  l.launch(victory, { id: 'a', name: 'Jeu', path: exe, console: 'series-x' });
  quit();
  await until(() => exits.length === 2, 'fermeture normale');
  assert.equal(l.state().status, 'stopped');

  const crash = path.join(path.dirname(exe), 'crash.exe');
  fs.writeFileSync(crash, '');
  l.launch(victory, { id: 'a', name: 'Jeu', path: crash, console: 'series-x' });
  await until(() => exits.length === 3, 'plantage');
  assert.deepEqual([exits[2], l.state().status], ["VIctory s'est arrêté (code 5)", 'failed']);

  fs.writeFileSync(victory, 'pas un programme');
  assert.throws(() => l.launch(victory, { id: 'a', name: 'Jeu', path: exe, console: 'series-x' }), /ne démarre pas/);
});

test('SixM Link : protocole, un seul client, entrées hostiles, arrêt avec SixM', { skip }, async () => {
  const linkDir = path.join(await tools(), 'link');
  const link = await startLink({ port: 0, dir: linkDir });
  const open = async () => {
    const s = net.connect(link.port, '127.0.0.1');
    s.setEncoding('utf8');
    const got = { text: '', closed: false, s };
    s.on('data', (d) => (got.text += d)).on('close', () => (got.closed = true)).on('error', () => {});
    return got;
  };
  const a = await open();
  await until(() => a.text.includes('"ready"'), 'ready');
  const b = await open();
  await until(() => b.closed, 'second client refusé');
  a.s.write('POST / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n{"t":"log","text":"pirate"}\n');
  await until(() => a.closed, 'requête HTTP coupée');

  for (const bad of ['[]', 'null', '12', '{"t":', 'x'.repeat(100)]) {
    let c;
    await until(async () => { c = await open(); await wait(80); return c.text.includes('ready'); }, 'reconnexion');
    c.s.write(`${bad}\n`);
    await until(() => c.closed, `coupé : ${bad}`);
  }
  let c;
  await until(async () => { c = await open(); await wait(80); return c.text.includes('ready'); }, 'reconnexion');
  for (const m of [
    { t: 'setRemote', id: 'x', name: 5, x: 'a', y: null }, { t: 'setRemote', id: 1e300, x: 1e300, y: -1e300 }, { t: 'setRemote' },
    { t: 'roster', players: 'x' }, { t: 'roster', players: [1, null, {}, 'A\u0000B'], server: 3 }, { t: 'log' }, { t: 'log', text: 'x'.repeat(5000) },
    { t: 'target', pid: -1 }, { t: 'target', pid: 'x' }, { t: 'inconnu' }, {},
  ]) c.s.write(JSON.stringify(m) + '\n');
  const png = path.join(tmp(), 'o.png');
  assert.equal(await link.dump(png), 'dumped visible=0 target=0 markers=0');
  assert.ok(fs.statSync(png).size > 500);
  assert.equal(c.closed, false);

  const second = await startLink({ port: link.port, dir: linkDir });
  assert.equal(second.external, true, 'port déjà servi : on réutilise le bridge présent');
  await link.stop();
  await assert.rejects(new Promise((res, rej) => net.connect(link.port, '127.0.0.1').on('connect', res).on('error', rej)));
});

test('liste des joueurs : visible même sans position', async () => {
  const srv = await createServer({ name: 'R', port: 0, syncRadius: 10 });
  const url = `ws://localhost:${srv.net.port}`;
  const mk = (name, local) => new SixMClient({ url, name, adapter: Object.assign(new MockAdapter(), { local }) });
  const a = mk('A', null), b = mk('B', null);
  await a.connect(); await b.connect();
  await until(() => a.roster.length === 2, 'A voit B');
  assert.deepEqual(a.roster.map((p) => p.name), ['A', 'B']);
  assert.equal(a.players.length, 0);
  await b.disconnect();
  await until(() => a.roster.length === 1, 'départ de B');
  await a.disconnect(); await srv.stop();
});

test('bout en bout : rejoindre lance le jeu, attache la surcouche, fermeture', { skip }, async () => {
  const { dir, victory, exe, quit } = await install();
  const dataDir = path.join(dir, 'data');
  fs.cpSync(path.join(await tools(), 'link'), path.join(dataDir, 'link'), { recursive: true });
  const port = await new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
  const app = await createApp({ dataDir, adapterOptions: { port, retryMs: 50 } });
  const call = async (p, body) => {
    const res = await fetch(app.origin + p, { method: body ? 'POST' : 'GET', body: body && JSON.stringify(body), headers: { 'x-sixm-token': app.token } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    return json;
  };
  const state = () => call('/api/state');
  const srv = await createServer({ name: 'Vice', port: 0, password: 'pw', resourcesDir: 'resources', autostart: ['hello'] });
  const address = `localhost:${srv.net.port}`;
  try {
    const { games } = await call('/api/settings', { victory, games: [{ name: 'Mon jeu', path: path.dirname(exe) }] });
    await assert.rejects(call('/api/game/launch', {}), /choisissez une installation/);
    await call('/api/settings', { target: games[0].id });

    await call('/api/settings', { victory: path.join(dir, 'absent.exe') });
    await assert.rejects(call('/api/connect', { address, password: 'pw' }), /VIctory introuvable/);
    await call('/api/settings', { victory });

    await call('/api/connect', { address, password: 'faux' });
    await until(async () => (await state()).session.error === 'mot de passe incorrect', 'refus');
    assert.equal((await state()).game.status, 'stopped', 'jeu non lancé si le serveur refuse');

    await call('/api/connect', { address, password: 'pw' });
    await until(async () => (await state()).game.status === 'running', 'jeu lancé');
    const max = new SixMClient({ url: `ws://${address}`, name: 'Max', password: 'pw', adapter: Object.assign(new MockAdapter(), { local: { x: 5, y: 5, z: 0, h: 0 } }) });
    await max.connect();
    max.emitServer('chat', 'salut depuis le serveur');
    await until(async () => (await state()).session.log.some((l) => l.text === 'Max: salut depuis le serveur'), 'chat reçu');
    assert.deepEqual((await state()).session.roster.map((p) => p.name), ['Joueur', 'Max']);

    const png = path.join(dir, 'overlay.png');
    await until(async () => (await app.link.dump(png)).includes('target=1'), 'surcouche attachée à la fenêtre du jeu');
    assert.ok(fs.statSync(png).size > 2000);
    if (process.env.SIXM_OVERLAY_PNG) {
      console.log(await app.link.dump(png));
      fs.copyFileSync(png, process.env.SIXM_OVERLAY_PNG);
    }

    quit();
    await until(async () => (await state()).session.status === 'idle', 'session fermée avec le jeu');
    assert.equal((await state()).session.error, 'le jeu est fermé');
    await max.disconnect();
  } finally {
    quit();
    await app.close();
    await srv.stop();
  }
});

test('adaptateur : écrit depuis le jeu, et tout est renvoyé après une coupure', async () => {
  const seen = [];
  let sock;
  const bridge = net.createServer((s) => {
    sock = s;
    s.setEncoding('utf8').on('data', (d) => seen.push(...d.trim().split('\n').map((l) => JSON.parse(l)))).on('error', () => {});
    s.write('{"t":"ready","build":"x"}\n');
  });
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  const a = new VictoryAdapter({ port: bridge.address().port, retryMs: 20 });
  const chat = [];
  a.onChat = (t) => chat.push(t);
  await a.init();
  a.setTarget(42); a.setTarget(42);
  a.setRoster('S', ['A']);
  await until(() => seen.length === 2, 'envoi sans doublon');
  sock.write('{"t":"chat","text":"hé"}\n{"t":"chat","text":5}\n');
  await until(() => chat.length, 'chat');
  assert.deepEqual(chat, ['hé']);
  seen.length = 0;
  sock.destroy();
  await until(() => seen.length === 2, 'renvoi');
  assert.deepEqual(seen, [{ t: 'target', pid: 42 }, { t: 'roster', server: 'S', players: ['A'] }]);
  await a.shutdown();
  bridge.close();
});
