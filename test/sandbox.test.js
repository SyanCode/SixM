import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { ScriptSandbox } from '../client/sandbox.js';
import { SixMClient } from '../client/client.js';
import { MockAdapter } from '../client/adapters/mock.js';

async function run(source, { limits, events = [] } = {}) {
  const logs = [], emits = [];
  const sb = await ScriptSandbox.create({
    onLog: (t) => logs.push(t), onEmit: (n, a) => emits.push([n, a]), limits,
  });
  sb.load([{ name: 'r', files: [{ file: 'c.js', source }] }]);
  for (const [n, a] of events) sb.dispatch(n, a);
  const alive = sb.resources.has('r');
  sb.dispose();
  return { logs, emits, alive };
}

test('sandbox : API utilisable', async () => {
  const { logs, emits } = await run(`
    sixm.on('chat', (a, o) => { sixm.log(a + o.n); sixm.emitServer('rep', { ok: true }, [1]); });
    Promise.resolve('micro').then(sixm.log);
  `, { events: [['chat', ['x', { n: 2 }]]] });
  assert.deepEqual(logs, ['micro', 'x2']);
  assert.deepEqual(emits, [['rep', [{ ok: true }, [1]]]]);
});

test('sandbox : aucun accès à Node', async () => {
  const { logs, alive } = await run(`
    const probes = [
      'typeof process', 'typeof require', 'typeof fetch', 'typeof Buffer', 'typeof WebAssembly',
      'typeof sixm.on.constructor("return this")().process',
      'typeof sixm.log.constructor("return this")().process',
      'typeof this.constructor.constructor("return this")().process',
      'typeof Object.getPrototypeOf(async () => {}).constructor("return this").process',
      'typeof console.log.constructor("return this")().require',
    ];
    for (const p of probes) sixm.log((0, eval)(p));
    try { throw new Error('x'); } catch (e) { sixm.log(typeof e.constructor.constructor('return this')().process); }
  `);
  assert.equal(alive, true, logs.join());
  assert.equal(logs.length, 11);
  assert.deepEqual([...new Set(logs)], ['undefined']);
});

test('sandbox : import() ne charge rien', async () => {
  const { logs } = await run(`
    import('node:fs').then(() => sixm.log('EVASION'), (e) => sixm.log('refus ' + typeof e.constructor.constructor('return this')().process));
  `);
  assert.ok(!logs.includes('EVASION'));
  assert.ok(logs.every((l) => !l.includes('object')), logs.join());
});

test('sandbox : boucle infinie coupée, même avec try/catch', async () => {
  const t0 = performance.now();
  const { alive, logs } = await run('for(;;){ try { for(;;); } catch {} }', { limits: { loadMs: 100 } });
  assert.equal(alive, false);
  assert.match(logs[0], /désactivée/);
  assert.ok(performance.now() - t0 < 1500);

  const ev = await run('sixm.on("e", () => { for(;;); })', { events: [['e', []]] });
  assert.equal(ev.alive, false);

  const jobs = await run('const f = () => Promise.resolve().then(f); f();', { limits: { loadMs: 100 } });
  assert.equal(jobs.alive, false, 'chaîne de promesses infinie');
});

test('sandbox : mémoire et pile bornées, le client survit', async () => {
  assert.equal((await run('const a=[]; for(;;) a.push(new Uint8Array(1<<20));')).alive, false);
  assert.equal((await run('(function f(){ f(); })()')).alive, false);
  assert.equal((await run('throw { get message() { for(;;); } }', { limits: { loadMs: 100 } })).alive, false);
});

test('sandbox : erreur dans un handler, les autres tournent ; débit borné', async () => {
  const { logs, alive } = await run(`
    sixm.on('e', () => { throw new Error('boum'); });
    sixm.on('e', () => sixm.log('suite'));
  `, { events: [['e', []]] });
  assert.equal(alive, true);
  assert.deepEqual(logs, ['erreur: Error: boum', 'suite']);

  // 100 appels par fenêtre d'une seconde, la première ouverte au premier appel. Une boucle plus longue
  // qu'une seconde (machine très lente) en ouvre une autre.
  const start = performance.now();
  const flood = await run('for (let i = 0; i < 5000; i++) sixm.log("x")');
  const windows = Math.floor((performance.now() - start) / 1000) + 1;
  assert.ok(flood.logs.length >= 100 && flood.logs.length <= 100 * windows, `${flood.logs.length} messages en ${windows} fenêtre(s)`);
});

test('client : serveur malveillant, textes nettoyés et scripts invalides refusés', async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on('listening', r));
  let welcome;
  wss.on('connection', (ws) => ws.on('message', () => {
    if (!welcome) return;
    ws.send(JSON.stringify(welcome));
    for (const m of [
      { t: 'snapshot', players: [null, { id: 2, name: 'A\u001b[2J', pos: { x: 1, y: 2, z: 3, h: 0 } }, { id: 3, name: 'B', pos: { x: 'NaN' } }] },
      { t: 'snapshot' }, { t: 'event' }, { t: 'event', name: 'e', args: 1 },
    ]) ws.send(JSON.stringify(m));
    welcome = null;
  }));
  const url = `ws://localhost:${wss.address().port}`;

  welcome = { t: 'welcome', id: 1, resources: [{ name: 'evil', files: [{ file: 'c.js', source: 'sixm.log("\\u001b[31m" + typeof sixm.on.constructor("return this")().process)' }] }] };
  const a = new MockAdapter();
  const c = new SixMClient({ url, name: 'A', adapter: a, renderIntervalMs: 5, interpolationDelayMs: 0 });
  await c.connect();
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(a.logs, [' [31mundefined']);
  assert.deepEqual([...a.remotes.keys()], [2]);
  assert.equal(a.remotes.get(2).name, 'A [2J');
  await c.disconnect();

  welcome = { t: 'welcome', id: 1, resources: 'nope' };
  await assert.rejects(new SixMClient({ url, name: 'A', adapter: new MockAdapter() }).connect(), /ressources invalides/);
  for (const ws of wss.clients) ws.terminate();
  wss.close();
});
