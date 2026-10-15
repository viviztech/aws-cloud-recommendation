import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishCatalog } from '../scripts/sync-prices.mjs';
import { catalog, NOW } from './fixtures.mjs';

test('publication is versioned, idempotent and preserves last valid catalog on error', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-price-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { currentPath: join(directory, 'catalog.json'), snapshotDirectory: join(directory, 'snapshots'), now: NOW };
  const first = catalog();
  await publishCatalog(first, options);
  await publishCatalog(first, options);
  assert.deepEqual(JSON.parse(await readFile(options.currentPath)), first);
  assert.deepEqual(JSON.parse(await readFile(join(options.snapshotDirectory, `${first.id}.json`))), first);

  const changedSameVersion = structuredClone(first);
  changedSameVersion.offers[0].price.hourly = 999;
  await assert.rejects(publishCatalog(changedSameVersion, options), /already exists with different data/);
  assert.deepEqual(JSON.parse(await readFile(options.currentPath)), first);

  const invalid = structuredClone(first);
  invalid.id = 'test-new-version';
  invalid.offers[0].price.hourly = -1;
  await assert.rejects(publishCatalog(invalid, options), /Catalog rejected/);
  assert.deepEqual(JSON.parse(await readFile(options.currentPath)), first);

  const next = structuredClone(first);
  next.id = 'test-next-version';
  next.offers[0].price.hourly = 0.2;
  await publishCatalog(next, options);
  assert.deepEqual(JSON.parse(await readFile(options.currentPath)), next);
  assert.deepEqual(JSON.parse(await readFile(join(options.snapshotDirectory, `${first.id}.json`))), first);
});
