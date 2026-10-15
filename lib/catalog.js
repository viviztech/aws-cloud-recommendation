const RATE_KEYS = [
  'diskGbMonth', 'egressGb', 'freeEgressGb', 'ipv4Hour', 'objectGbMonth',
  'objectRequestsMillion', 'backupGbMonth', 'loadBalancerHour', 'managedDbMonth',
];

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const positive = value => nonnegative(value) && value > 0;
const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value));
const https = value => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};

/** Validate a normalized catalog. Null rates mean unknown; zero must mean verified free/included. */
export function validateCatalog(catalog, { now = new Date(), allowUnverified = true } = {}) {
  const errors = [];
  const warnings = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  if (!isObject(catalog)) return { valid: false, errors: ['Catalog must be an object.'], warnings };
  require(catalog.schemaVersion === 1, 'schemaVersion must be 1.');
  require(typeof catalog.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(catalog.id), 'id must be a safe version identifier.');
  require(isoDate(catalog.publishedAt), 'publishedAt must be an ISO date.');
  if (isoDate(catalog.publishedAt) && Date.parse(catalog.publishedAt) > +new Date(now) + 86_400_000) {
    errors.push('publishedAt cannot be more than one day in the future.');
  }
  require(isObject(catalog.fx), 'fx must be an object.');
  if (isObject(catalog.fx)) {
    require(isoDate(catalog.fx.asOf), 'fx.asOf must be an ISO date.');
    require(typeof catalog.fx.source === 'string' && catalog.fx.source.length > 0, 'fx.source is required.');
    require(isObject(catalog.fx.rates) && catalog.fx.rates.USD === 1, 'fx.rates must include USD: 1.');
    for (const [currency, rate] of Object.entries(catalog.fx.rates ?? {})) {
      require(/^[A-Z]{3}$/.test(currency) && positive(rate), `Invalid FX rate ${currency}.`);
    }
  }
  require(Array.isArray(catalog.providers) && catalog.providers.length > 0, 'providers must be a nonempty array.');
  require(Array.isArray(catalog.offers), 'offers must be an array.');
  require(Array.isArray(catalog.coverage), 'coverage must be an array.');
  const providerIds = new Set();
  for (const provider of Array.isArray(catalog.providers) ? catalog.providers : []) {
    if (!isObject(provider)) { errors.push('Each provider must be an object.'); continue; }
    require(typeof provider.id === 'string' && /^[a-z0-9-]+$/.test(provider.id), 'Provider id must use lowercase letters, digits and hyphens.');
    require(!providerIds.has(provider.id), `Duplicate provider: ${provider.id}.`);
    providerIds.add(provider.id);
    require(typeof provider.name === 'string' && provider.name.length > 0, `Provider ${provider.id} needs a name.`);
    require(https(provider.website), `Provider ${provider.id} needs an HTTPS website.`);
    require(https(provider.calculatorUrl), `Provider ${provider.id} needs an HTTPS calculatorUrl.`);
  }
  const offerIds = new Set();
  for (const offer of Array.isArray(catalog.offers) ? catalog.offers : []) {
    if (!isObject(offer)) { errors.push('Each offer must be an object.'); continue; }
    const prefix = `Offer ${offer.id ?? '(no id)'}`;
    require(typeof offer.id === 'string' && offer.id.length > 0, `${prefix} needs an id.`);
    require(!offerIds.has(offer.id), `${prefix} has a duplicate id.`);
    offerIds.add(offer.id);
    require(providerIds.has(offer.provider), `${prefix} references an unknown provider.`);
    require(['vm', 'gpu', 'static'].includes(offer.kind), `${prefix} has an invalid kind.`);
    require(typeof offer.name === 'string' && offer.name.length > 0, `${prefix} needs a name.`);
    require(isObject(offer.region), `${prefix} needs a region.`);
    if (isObject(offer.region)) {
      require(typeof offer.region.id === 'string' && offer.region.id.length > 0, `${prefix} needs a region id.`);
      require(typeof offer.region.name === 'string' && offer.region.name.length > 0, `${prefix} needs a region name.`);
      require(/^[A-Z]{2}$/.test(offer.region.country), `${prefix} region.country must be an ISO two-letter country code.`);
      require(Number.isInteger(offer.region.zoneCount) && offer.region.zoneCount >= 1, `${prefix} zoneCount must be a positive integer.`);
    }
    require(nonnegative(offer.vcpu), `${prefix} vcpu must be nonnegative.`);
    require(nonnegative(offer.memoryGb), `${prefix} memoryGb must be nonnegative.`);
    require(['x86', 'arm'].includes(offer.architecture), `${prefix} architecture must be x86 or arm.`);
    require(['shared', 'dedicated'].includes(offer.cpuClass), `${prefix} cpuClass must be shared or dedicated.`);
    require(['on-demand', 'spot'].includes(offer.purchase), `${prefix} purchase must be on-demand or spot.`);
    require(['unknown', 'available', 'unavailable'].includes(offer.capacity), `${prefix} has invalid capacity.`);
    require(typeof offer.verified === 'boolean', `${prefix} verified must be boolean.`);
    if (offer.regionalPricingVerified !== undefined) require(typeof offer.regionalPricingVerified === 'boolean', `${prefix} regionalPricingVerified must be boolean.`);
    if (offer.verified === false) {
      (allowUnverified ? warnings : errors).push(`${prefix} is unverified.`);
    }
    if (offer.kind === 'gpu') {
      require(isObject(offer.gpu), `${prefix} needs GPU specifications.`);
      if (isObject(offer.gpu)) {
        require(typeof offer.gpu.model === 'string' && offer.gpu.model.length > 0, `${prefix} needs a GPU model.`);
        require(Number.isInteger(offer.gpu.count) && offer.gpu.count > 0, `${prefix} GPU count must be a positive integer.`);
        require(positive(offer.gpu.vramGb), `${prefix} needs positive VRAM per GPU.`);
        require(typeof offer.gpu.interconnect === 'boolean', `${prefix} GPU interconnect must be boolean.`);
      }
    } else require(offer.gpu === null, `${prefix} non-GPU offer must use gpu: null.`);
    require(isObject(offer.price), `${prefix} needs a price object.`);
    if (isObject(offer.price)) {
      require(/^[A-Z]{3}$/.test(offer.price.currency), `${prefix} price.currency must be an ISO currency code.`);
      for (const key of ['hourly', 'monthly', 'monthlyCap']) {
        require(offer.price[key] === null || nonnegative(offer.price[key]), `${prefix} price.${key} must be nonnegative or null.`);
      }
      if (offer.price.hourly === null && offer.price.monthly === null) warnings.push(`${prefix} has no known compute price.`);
      for (const key of ['includedDiskGb', 'includedTransferGb']) require(nonnegative(offer.price[key]), `${prefix} price.${key} must be nonnegative.`);
      require(Number.isInteger(offer.price.billingIncrementSeconds) && offer.price.billingIncrementSeconds > 0, `${prefix} needs a positive billing increment.`);
      if (offer.price.billingUnit !== undefined) require(['instance-hour', 'gpu-hour'].includes(offer.price.billingUnit), `${prefix} billingUnit must be instance-hour or gpu-hour.`);
      for (const key of ['transferAccrualHours', 'minimumBillingSeconds']) {
        if (offer.price[key] !== undefined) require(positive(offer.price[key]), `${prefix} price.${key} must be positive.`);
      }
      if (offer.price.minimumCharge !== undefined) require(nonnegative(offer.price.minimumCharge), `${prefix} price.minimumCharge must be nonnegative.`);
      for (const key of ['diskUnit', 'transferUnit', 'egressUnit']) {
        if (offer.price[key] !== undefined) require(['GB', 'GiB'].includes(offer.price[key]), `${prefix} price.${key} must be GB or GiB.`);
      }
    }
    require(isObject(offer.rates), `${prefix} needs rates.`);
    if (isObject(offer.rates)) {
      for (const key of RATE_KEYS) require(offer.rates[key] === null || nonnegative(offer.rates[key]), `${prefix} rates.${key} must be nonnegative or null.`);
      for (const key of ['diskUnit', 'transferUnit', 'egressUnit']) {
        if (offer.rates[key] !== undefined) require(['GB', 'GiB'].includes(offer.rates[key]), `${prefix} rates.${key} must be GB or GiB.`);
      }
      for (const key of ['diskMinimumGb', 'diskIncrementGb']) {
        if (offer.rates[key] !== undefined) require(nonnegative(offer.rates[key]), `${prefix} rates.${key} must be nonnegative.`);
      }
      if (offer.rates.ipv4MonthlyCap !== undefined) require(nonnegative(offer.rates.ipv4MonthlyCap), `${prefix} rates.ipv4MonthlyCap must be nonnegative.`);
      for (const key of ['diskMaxGb', 'egressMaxGb']) {
        if (offer.rates[key] !== undefined) require(nonnegative(offer.rates[key]), `${prefix} rates.${key} must be nonnegative.`);
      }
      if (offer.rates.diskTiers !== undefined) {
        require(Array.isArray(offer.rates.diskTiers) && offer.rates.diskTiers.length > 0, `${prefix} diskTiers must be a nonempty array.`);
        let previous = 0;
        for (const [index, tier] of (Array.isArray(offer.rates.diskTiers) ? offer.rates.diskTiers : []).entries()) {
          require(isObject(tier) && nonnegative(tier.monthly) && positive(tier.upToGb) && tier.upToGb > previous, `${prefix} disk tier ${index} needs ascending finite upToGb and a nonnegative monthly price.`);
          previous = tier.upToGb;
        }
      }
      if (offer.rates.egressTiers !== undefined) {
        require(Array.isArray(offer.rates.egressTiers), `${prefix} egressTiers must be an array.`);
        let previous = 0;
        for (const [index, tier] of (Array.isArray(offer.rates.egressTiers) ? offer.rates.egressTiers : []).entries()) {
          const bound = tier?.upToGb === null ? Infinity : tier?.upToGb;
          require(isObject(tier) && nonnegative(tier.rate) && bound > previous, `${prefix} egress tier ${index} needs ascending upToGb and a nonnegative rate.`);
          previous = bound;
        }
        require(previous === Infinity, `${prefix} egressTiers must end with upToGb: null.`);
      }
      for (const [key, url] of Object.entries(offer.rates.sources ?? {})) require(https(url), `${prefix} rates.sources.${key} must be HTTPS.`);
    }
    require(isObject(offer.source), `${prefix} needs source provenance.`);
    if (isObject(offer.source)) {
      require(https(offer.source.url), `${prefix} source.url must be HTTPS.`);
      require(isoDate(offer.source.checkedAt), `${prefix} source.checkedAt must be an ISO date.`);
      require(offer.source.effectiveAt === null || isoDate(offer.source.effectiveAt), `${prefix} source.effectiveAt must be an ISO date or null.`);
      if (isoDate(offer.source.checkedAt) && Date.parse(offer.source.checkedAt) > +new Date(now) + 86_400_000) errors.push(`${prefix} checkedAt cannot be more than one day in the future.`);
    }
  }
  for (const entry of Array.isArray(catalog.coverage) ? catalog.coverage : []) {
    require(isObject(entry) && providerIds.has(entry.provider) && ['vm', 'gpu', 'static'].includes(entry.kind) && typeof entry.reason === 'string' && entry.reason.length > 0, 'Coverage entries need a known provider, valid kind and reason.');
  }
  const freshness = catalogFreshness(catalog, { now });
  if (freshness.status === 'stale') warnings.push(`Oldest source was checked ${freshness.ageDays} days ago. Refresh pricing before purchasing.`);
  return { valid: errors.length === 0, errors, warnings };
}

/** Age uses the oldest offer check, not a new publication date on old data. */
export function catalogFreshness(catalog, { now = new Date(), staleAfterDays = 30 } = {}) {
  const dates = (Array.isArray(catalog?.offers) ? catalog.offers : []).map(offer => offer?.source?.checkedAt).filter(isoDate);
  if (!dates.length) return { status: 'unknown', ageDays: null, checkedAt: null };
  const oldest = Math.min(...dates.map(Date.parse));
  const ageDays = Math.max(0, Math.floor((+new Date(now) - oldest) / 86_400_000));
  return { status: ageDays > staleAfterDays ? 'stale' : 'fresh', ageDays, checkedAt: new Date(oldest).toISOString() };
}

export function assertCatalog(catalog, options) {
  const result = validateCatalog(catalog, options);
  if (!result.valid) throw new Error(`Invalid pricing catalog:\n${result.errors.join('\n')}`);
  return catalog;
}
