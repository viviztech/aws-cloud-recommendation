import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, offer, NOW } from './fixtures.mjs';
import { validateCatalog, catalogFreshness } from '../lib/catalog.js';

test('valid catalogs retain unknown rates rather than assigning a zero', () => {
  const input = catalog([offer({ rates: { managedDbMonth: null } })]);
  assert.equal(validateCatalog(input, { now: NOW }).valid, true);
  assert.equal(input.offers[0].rates.managedDbMonth, null);
});

test('catalog rejects negative prices, duplicate ids and invalid provenance', () => {
  const result = validateCatalog(catalog([offer({ price: { hourly: -1 } }), offer({ source: { url: 'javascript:alert(1)' } })]), { now: NOW });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /hourly/);
  assert.match(result.errors.join('\n'), /duplicate/);
  assert.match(result.errors.join('\n'), /HTTPS/);
});

test('catalog rejects missing prices instead of treating undefined as included', () => {
  const input = catalog();
  delete input.offers[0].rates.ipv4Hour;
  assert.equal(validateCatalog(input, { now: NOW }).valid, false);
});

test('freshness reflects the oldest check, independent of republishing', () => {
  const input = catalog([offer({ source: { checkedAt: '2026-08-01' } }), offer({ id: 'new-offer' })]);
  assert.deepEqual(catalogFreshness(input, { now: NOW }), { status: 'stale', ageDays: 75, checkedAt: '2026-08-01T00:00:00.000Z' });
});

test('unknown freshness and malformed catalogs return useful validation errors', () => {
  assert.equal(catalogFreshness({ offers: [] }, { now: NOW }).status, 'unknown');
  for (const input of [null, {}, { providers: null, offers: null }]) assert.equal(validateCatalog(input, { now: NOW }).valid, false);
});

test('unverified offers cannot pass a publication check', () => {
  const input = catalog([offer({ verified: false })]);
  assert.equal(validateCatalog(input, { now: NOW }).valid, true);
  assert.equal(validateCatalog(input, { now: NOW, allowUnverified: false }).valid, false);
});

test('tier schedule must be ordered and cover all usage', () => {
  const invalid = catalog([offer({ rates: { egressTiers: [{ upToGb: 100, rate: 0.1 }, { upToGb: 50, rate: 0.05 }] } })]);
  assert.equal(validateCatalog(invalid, { now: NOW }).valid, false);
  const valid = catalog([offer({ rates: { egressTiers: [{ upToGb: 100, rate: 0.1 }, { upToGb: null, rate: 0.05 }] } })]);
  assert.equal(validateCatalog(valid, { now: NOW }).valid, true);
});

test('catalog rejects invalid optional units and billing minima', () => {
  for (const overrides of [
    { price: { transferAccrualHours: 0 } }, { price: { minimumBillingSeconds: -1 } },
    { price: { minimumCharge: -1 } }, { price: { transferUnit: 'TB' } },
    { price: { billingUnit: 'unknown' } }, { rates: { ipv4MonthlyCap: -1 } },
    { rates: { diskMaxGb: -1 } }, { rates: { egressMaxGb: Infinity } },
  ]) assert.equal(validateCatalog(catalog([offer(overrides)]), { now: NOW }).valid, false);
});
