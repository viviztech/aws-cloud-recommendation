export const NOW = new Date('2026-10-15T12:00:00Z');
export const rateDefaults = {
  diskGbMonth: 0.1, egressGb: 0.1, freeEgressGb: 0, ipv4Hour: 0,
  objectGbMonth: 0.02, objectRequestsMillion: 0.5, backupGbMonth: 0.05,
  loadBalancerHour: 0.01, managedDbMonth: 20,
};

/** Explicitly fictional fixtures; never served as the production pricing catalog. */
export function offer(overrides = {}) {
  const base = {
    id: 'test-vm', provider: 'test', kind: 'vm', name: 'Fictional test VM',
    region: { id: 'test-india', name: 'Test India', country: 'IN', zoneCount: 3 },
    vcpu: 4, memoryGb: 8, architecture: 'x86', cpuClass: 'dedicated', gpu: null,
    price: { currency: 'USD', hourly: 0.1, monthly: null, monthlyCap: null, includedDiskGb: 0, includedTransferGb: 0, billingIncrementSeconds: 1 },
    rates: { ...rateDefaults },
    source: { url: 'https://example.com/test-price', checkedAt: '2026-10-15', effectiveAt: null, notes: 'Fictional test fixture' },
    capacity: 'unknown', purchase: 'on-demand', verified: true,
  };
  return { ...base, ...overrides, region: { ...base.region, ...overrides.region }, price: { ...base.price, ...overrides.price }, rates: { ...base.rates, ...overrides.rates }, source: { ...base.source, ...overrides.source } };
}

export function catalog(offers = [offer()], overrides = {}) {
  return {
    schemaVersion: 1, id: 'test-2026-10-15', publishedAt: '2026-10-15',
    fx: { asOf: '2026-10-15', source: 'Fictional test exchange rate', rates: { USD: 1, INR: 80, EUR: 0.8 } },
    providers: [{ id: 'test', name: 'Fictional provider', color: '#123456', website: 'https://example.com', calculatorUrl: 'https://example.com/calculator', notes: 'Test only' }],
    offers, coverage: [], ...overrides,
  };
}

export function workload(overrides = {}) {
  return {
    mode: 'general', profile: 'advanced', workloadType: 'webapp', geography: 'india',
    currency: 'USD', vcpu: 2, memoryGb: 4, instances: 1, hours: 730,
    diskGb: 0, objectGb: 0, objectRequestsMillions: 0, transferGb: 0, backupGb: 0,
    database: 'none', databaseGb: 20, availability: 'standard', cpuClass: 'any', architecture: 'any',
    growthFactor: 1, operationsHours: 0, operationsRateUSD: 0, monitoringMonthlyUSD: 0,
    ...overrides,
  };
}

export function gpuOffer(overrides = {}) {
  return offer({ id: 'test-gpu', kind: 'gpu', name: 'Fictional GPU instance', vcpu: 16, memoryGb: 64,
    gpu: { model: 'A100', count: 2, vramGb: 40, interconnect: false },
    ...overrides, price: { hourly: 2, ...overrides.price } });
}

export function gpuWorkload(overrides = {}) {
  return workload({ mode: 'gpu', gpuTask: 'training', gpuModel: 'any', gpuCount: 1,
    vramGb: 24, gpuHours: 10, jobCount: 1, allowDistributed: false,
    purchase: 'on-demand', retainedMonths: 1, ...overrides });
}
