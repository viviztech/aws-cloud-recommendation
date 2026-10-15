import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('local server serves ES modules and keeps repository files private', async t => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/serve.mjs', import.meta.url)), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'error').then(([error]) => { throw error; }),
    once(child, 'exit').then(([code]) => { throw new Error(`Server exited before listening (${code}).`); }),
  ]);
  const base = `http://127.0.0.1:${port}`;
  const moduleResponse = await fetch(`${base}/lib/catalog.js`);
  assert.equal(moduleResponse.status, 200);
  assert.match(moduleResponse.headers.get('content-type'), /text\/javascript/);
  assert.equal(moduleResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base)).status, 200);
  for (const path of ['/.git/config', '/package.json', '/scripts/sync-prices.mjs', '/tests/fixtures.mjs', '/data/staging/raw.json', '/lib/%2e%2e%5c.git/config']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  const head = await fetch(`${base}/lib/catalog.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await fetch(base, { method: 'POST' });
  assert.equal(post.status, 405);
});
