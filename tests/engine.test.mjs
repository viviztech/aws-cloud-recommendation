import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, validateWorkload } from '../lib/engine.js';
import { catalog, offer, workload, gpuOffer, gpuWorkload, NOW } from './fixtures.mjs';

const run = (input, offers, extra = {}) => compare(input, catalog(offers, extra), { now: NOW });
const amount = (quote, label) => quote.lineItems.find(item => item.label === label)?.amount;

test('missing rates remain incomplete and cannot undercut a complete provider', () => {
  const providers = catalog().providers;
  providers.push({ ...providers[0], id: 'cheap', name: 'Fictional incomplete provider' });
  const result = run(workload({ diskGb: 100 }), [
    offer(), offer({ id: 'cheap-vm', provider: 'cheap', price: { hourly: 0.001 }, rates: { diskGbMonth: null } }),
  ], { providers });
  assert.equal(result.best.providerId, 'test');
  assert.equal(result.quotes[0].status, 'complete');
  assert.equal(result.quotes[1].status, 'partial');
  assert.equal(result.quotes[1].total, null);
  assert.match(result.quotes[1].reasons.join(' '), /disk/i);
});

test('within a provider a complete quote wins over a cheaper incomplete offer', () => {
  const result = run(workload({ diskGb: 20 }), [offer({ id: 'cheap-unverified', price: { hourly: 0.001 }, rates: { diskGbMonth: null } }), offer({ id: 'complete' })]);
  assert.equal(result.best.id, 'complete');
});

test('India filter excludes Singapore while nearby Asia allows it', () => {
  const singapore = offer({ region: { id: 'test-sg', name: 'Test Singapore', country: 'SG' } });
  assert.equal(run(workload(), [singapore]).quotes[0].status, 'unsupported');
  assert.equal(run(workload({ geography: 'asia' }), [singapore]).best.status, 'complete');
});

test('monthly cap and bundled disks/transfer apply without double charging', () => {
  const result = run(workload({ diskGb: 40, transferGb: 200 }), [offer({
    price: { monthlyCap: 50, includedDiskGb: 25, includedTransferGb: 100 }, rates: { freeEgressGb: 20 },
  })]);
  assert.equal(result.best.total, 59.5);
  assert.equal(amount(result.best, 'Compute'), 50);
  assert.equal(amount(result.best, 'Additional persistent disk'), 1.5);
  assert.equal(amount(result.best, 'Outbound transfer'), 8);
});

test('monthly-only products retain their minimum at short runtime', () => {
  const result = run(workload({ hours: 1 }), [offer({ price: { hourly: null, monthly: 40 } })]);
  assert.equal(result.best.total, 40);
});

test('fixed disk tiers bill a provisioned tier and reject uncovered sizes', () => {
  const tiered = offer({ rates: { diskGbMonth: null, diskTiers: [{ upToGb: 32, monthly: 3 }, { upToGb: 64, monthly: 5 }] } });
  const result = run(workload({ diskGb: 33 }), [tiered]);
  assert.equal(amount(result.best, 'Additional persistent disk'), 5);
  assert.equal(run(workload({ diskGb: 65 }), [tiered]).best, null);
});

test('minimum disk size and provisioning increments are charged explicitly', () => {
  const minimum = offer({ rates: { diskMinimumGb: 50, diskIncrementGb: 10 } });
  assert.equal(amount(run(workload({ diskGb: 1 }), [minimum]).best, 'Additional persistent disk'), 5);
  assert.equal(amount(run(workload({ diskGb: 51 }), [minimum]).best, 'Additional persistent disk'), 6);
});

test('known free allowances and monthly disk costs scale with runtime', () => {
  const result = run(workload({ hours: 365, diskGb: 40, transferGb: 100 }), [offer({ price: { includedTransferGb: 100 } })]);
  assert.equal(amount(result.best, 'Compute'), 36.5);
  assert.equal(amount(result.best, 'Additional persistent disk'), 2);
  assert.equal(amount(result.best, 'Outbound transfer'), 5);
});

test('transfer accrues over the documented provider period rather than an assumed 730 hours', () => {
  const result = run(workload({ hours: 336, transferGb: 100 }), [offer({ price: { includedTransferGb: 100, transferAccrualHours: 672 } })]);
  assert.equal(amount(result.best, 'Outbound transfer'), 5);
});

test('binary included disk/transfer units are normalized to decimal input GB', () => {
  const result = run(workload({ diskGb: 26, transferGb: 107.3741824 }), [offer({
    price: { includedDiskGb: 25, includedTransferGb: 100, diskUnit: 'GiB', transferUnit: 'GiB' },
  })]);
  assert.equal(result.best.total, 73);
  assert.equal(amount(result.best, 'Additional persistent disk'), undefined);
  assert.equal(amount(result.best, 'Outbound transfer'), undefined);
});

test('public IP monthly cap applies per provisioned address', () => {
  const result = run(workload({ instances: 2 }), [offer({ rates: { ipv4Hour: 0.01, ipv4MonthlyCap: 5 } })]);
  assert.equal(amount(result.best, 'Public IPv4'), 10);
});

test('tiered egress charges each graduated band once', () => {
  const result = run(workload({ transferGb: 250 }), [offer({ rates: { egressGb: null, egressTiers: [{ upToGb: 100, rate: 0.1 }, { upToGb: null, rate: 0.05 }] } })]);
  assert.equal(result.best?.status, 'complete');
  assert.equal(amount(result.best, 'Outbound transfer'), 17.5);
});

test('managed database cannot inherit the no-database or self-managed price', () => {
  assert.equal(run(workload(), [offer({ rates: { managedDbMonth: null } })]).best.status, 'complete');
  const managed = run(workload({ database: 'managed' }), [offer({ rates: { managedDbMonth: null } })]);
  assert.equal(managed.best, null);
  assert.equal(managed.quotes[0].total, null);
  assert.match(managed.quotes[0].reasons.join(' '), /managed PostgreSQL/);
  const self = run(workload({ database: 'self-managed', diskGb: 0, databaseGb: 20 }), [offer()]);
  assert.equal(self.best.total, 75);
});

test('managed database requires a matching plan including HA coverage', () => {
  const matched = offer({ managedDatabase: { name: 'Fictional DB', storageGb: 40, highAvailability: false }, loadBalancerIncludesTraffic: true });
  assert.equal(run(workload({ database: 'managed' }), [matched]).best.total, 93);
  assert.equal(run(workload({ database: 'managed', databaseGb: 50 }), [matched]).best, null);
  assert.equal(run(workload({ database: 'managed', availability: 'high' }), [matched]).best, null);
});

test('HA requires separate zones and known load-balancer pricing', () => {
  assert.equal(run(workload({ availability: 'high' }), [offer({ region: { zoneCount: 1 } })]).quotes[0].status, 'unsupported');
  assert.equal(run(workload({ availability: 'high' }), [offer({ rates: { loadBalancerHour: null } })]).quotes[0].status, 'partial');
  const supported = run(workload({ availability: 'high' }), [offer({ loadBalancerIncludesTraffic: true })]);
  assert.equal(amount(supported.best, 'Compute'), 146);
  assert.equal(amount(supported.best, 'Load balancer'), 7.3);
});

test('GPU selection tests per-card memory instead of silently pooling VRAM', () => {
  const insufficient = run(gpuWorkload({ gpuCount: 2, vramGb: 60 }), [gpuOffer()]);
  assert.equal(insufficient.quotes[0].status, 'unsupported');
  assert.equal(run(gpuWorkload({ gpuCount: 2, vramGb: 60, allowDistributed: true }), [gpuOffer()]).best, null);
  const distributed = run(gpuWorkload({ gpuCount: 2, vramGb: 60, allowDistributed: true }), [gpuOffer({ gpu: { model: 'A100', count: 2, vramGb: 40, interconnect: true } })]);
  assert.equal(distributed.best.status, 'complete');
});

test('GPU families accept vendor prefixes and matching variants without matching other families', () => {
  const hardware = model => gpuOffer({ gpu: { model, count: 1, vramGb: 80, interconnect: false } });
  assert.equal(run(gpuWorkload({ gpuModel: 'A100' }), [hardware('NVIDIA A100 PCIe')]).best.status, 'complete');
  assert.equal(run(gpuWorkload({ gpuModel: 'H100' }), [hardware('NVIDIA H100 SXM')]).best.status, 'complete');
  assert.equal(run(gpuWorkload({ gpuModel: 'L4' }), [hardware('NVIDIA L40S')]).quotes[0].status, 'unsupported');
  assert.equal(run(gpuWorkload({ gpuModel: 'H100 PCIe' }), [hardware('NVIDIA H100 SXM')]).quotes[0].status, 'unsupported');
});

test('pooled VRAM requires explicitly verified boolean interconnect support', () => {
  const input = gpuWorkload({ gpuCount: 2, vramGb: 60, allowDistributed: true });
  for (const interconnect of [false, 'PCIe', 'Not specified', null]) {
    const result = run(input, [gpuOffer({ gpu: { model: 'A100', count: 2, vramGb: 40, interconnect } })]);
    assert.equal(result.quotes[0].status, 'unsupported', `Unverified interconnect ${String(interconnect)} must not pool VRAM`);
    assert.equal(result.best, null);
  }
});

test('whole GPU instances are billed once, with rounded GPU counts', () => {
  const result = run(gpuWorkload({ gpuCount: 3 }), [gpuOffer()]);
  assert.equal(result.best.hardware.instances, 2);
  assert.equal(amount(result.best, 'GPU instances'), 40);
  assert.equal(result.best.total, 40);
});

test('global GPU reference rates cannot win as a verified regional estimate', () => {
  const result = run(gpuWorkload(), [gpuOffer({ regionalPricingVerified: false })]);
  assert.equal(result.best, null);
  assert.equal(result.quotes[0].status, 'partial');
  assert.match(result.quotes[0].reasons.join(' '), /regional/i);
});

test('per-GPU-hour tariffs differ explicitly from whole-instance tariffs', () => {
  const result = run(gpuWorkload({ gpuCount: 3 }), [gpuOffer({ price: { billingUnit: 'gpu-hour' } })]);
  assert.equal(amount(result.best, 'GPU instances'), 80);
});

test('GPU billing rounds each job and includes retained disk separately', () => {
  const result = run(gpuWorkload({ gpuHours: 0.1, jobCount: 3, diskGb: 100, retainedMonths: 2 }), [gpuOffer({ price: { billingIncrementSeconds: 3600 } })]);
  assert.equal(amount(result.best, 'GPU instances'), 6);
  assert.equal(amount(result.best, 'Additional persistent disk'), 20);
});

test('per-job minimum runtime and minimum currency charge are both respected', () => {
  const result = run(gpuWorkload({ gpuHours: 1 / 3600, jobCount: 3 }), [gpuOffer({ price: { hourly: 0.1, minimumBillingSeconds: 60, minimumCharge: 0.01 } })]);
  assert.equal(amount(result.best, 'GPU instances'), 0.03);
});

test('GPU compute monthly billing follows runtime independently of retained disk months', () => {
  const capped = gpuOffer({ price: { monthlyCap: 1000 } });
  const runtime = gpuWorkload({ gpuHours: 2000 });
  assert.equal(amount(run(runtime, [capped]).best, 'GPU instances'), 3000);
  assert.equal(amount(run({ ...runtime, retainedMonths: 12 }, [capped]).best, 'GPU instances'), 3000);
  const monthly = gpuOffer({ price: { hourly: null, monthly: 100 } });
  assert.equal(amount(run(runtime, [monthly]).best, 'GPU instances'), 300);
  assert.equal(amount(run({ ...runtime, retainedMonths: 12 }, [monthly]).best, 'GPU instances'), 300);
});

test('minimum charge remains a floor even when a cap is configured', () => {
  const result = run(gpuWorkload({ gpuHours: 1 / 3600 }), [gpuOffer({ price: { minimumCharge: 0.01, monthlyCap: 0.001 } })]);
  assert.equal(amount(result.best, 'GPU instances'), 0.01);
});

test('missing exchange rate cannot create a zero-cost winner; manual INR conversion works', () => {
  const fx = { asOf: '2026-10-15', source: 'Test only', rates: { USD: 1 } };
  const missing = run(workload({ currency: 'INR' }), [offer()], { fx });
  assert.equal(missing.best, null);
  assert.equal(missing.quotes[0].total, null);
  const manual = run(workload({ currency: 'INR', fxRate: 80 }), [offer()], { fx });
  assert.equal(manual.best.total, 5840);
});

test('a manual INR/USD rate also refreshes conversion from native INR to displayed USD', () => {
  const fx = { asOf: '2025-01-01', source: 'Stale test reference', rates: { USD: 1, INR: 75 } };
  const result = run(workload({ currency: 'USD', fxRate: 80 }), [offer({ price: { currency: 'INR', hourly: 8 } })], { fx });
  assert.equal(result.best.total, 73);
  assert.match(result.best.assumptions.join(' '), /supplied 80 INR\/USD/);
});

test('same inputs, version and evaluation time reproduce the exact estimate', () => {
  const input = workload({ diskGb: 40, transferGb: 125.5 });
  const inputCatalog = catalog();
  const before = JSON.stringify(inputCatalog);
  assert.deepEqual(compare(input, inputCatalog, { now: NOW }), compare(input, inputCatalog, { now: NOW }));
  assert.equal(JSON.stringify(inputCatalog), before);
});

test('prices over 90 days old cannot win; stale prices carry a visible warning', () => {
  const old = run(workload(), [offer({ source: { checkedAt: '2026-01-01' } })]);
  assert.equal(old.best, null);
  const stale = run(workload(), [offer({ source: { checkedAt: '2026-09-01' } })]);
  assert.equal(stale.best.stale, true);
  assert.match(stale.warnings.join(' '), /30 days/);
});

test('validation blocks impossible users, nonfinite resources and empty provider selections', () => {
  assert.equal(validateWorkload({ profile: 'guided', active: 100, concurrent: 101 }).value, null);
  assert.equal(validateWorkload({ vcpu: 'Infinity' }).value, null);
  assert.equal(validateWorkload({ providers: [] }).value, null);
  assert.equal(validateWorkload(gpuWorkload({ gpuCount: 1.5 })).value, null);
});

test('usage beyond an imported price band remains incomplete instead of extending a rate indefinitely', () => {
  const bounded = offer({ rates: { egressMaxGb: 100, diskMaxGb: 50 } });
  assert.equal(run(workload({ transferGb: 100, diskGb: 50 }), [bounded]).best.status, 'complete');
  const network = run(workload({ transferGb: 101 }), [bounded]);
  assert.equal(network.best, null);
  assert.match(network.quotes[0].reasons.join(' '), /transfer exceeds/);
  const disk = run(workload({ diskGb: 51 }), [bounded]);
  assert.equal(disk.best, null);
  assert.match(disk.quotes[0].reasons.join(' '), /disk exceeds/);
});
