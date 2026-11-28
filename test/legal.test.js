import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';

test('accueil, confidentialité et mentions légales en HTML, avec le pied de page', async () => {
  const srv = await createServer({ name: 'Test <b>', port: 0, resourcesDir: 'resources', visibility: 'private' });
  const base = `http://localhost:${srv.net.port}`;
  try {
    for (const path of ['/', '/confidentialite', '/mentions-legales']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type'), /^text\/html/);
      const html = await res.text();
      assert.ok(html.includes('href="/confidentialite"'), `${path} lie la confidentialité`);
      assert.ok(html.includes('href="/mentions-legales"'), `${path} lie les mentions légales`);
      assert.ok(!html.includes('Test <b>'), 'le nom du serveur est échappé');
    }
    const info = await fetch(`${base}/info.json`);
    assert.equal(info.status, 200);
    assert.equal((await info.json()).name, 'Test <b>');
    assert.equal((await fetch(`${base}/inconnu`)).status, 404);
  } finally {
    await srv.stop();
  }
});
