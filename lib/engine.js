// Deterministic estimates: no network requests, credentials, or inferred live capacity.
export const DEFAULTS = Object.freeze({
  mode: 'general', profile: 'guided', workloadType: 'webapp', geography: 'asia', currency: 'USD',
  registered: 10000, active: 2000, concurrent: 100, vcpu: 2, memoryGb: 4, instances: 1,
  hours: 730, diskGb: 40, objectGb: 0, objectRequestsMillions: 0, transferGb: 200, backupGb: 0,
  database: 'none', databaseGb: 20, availability: 'standard', cpuClass: 'any', architecture: 'x86',
  growthFactor: 1, operationsHours: 0, operationsRateUSD: 0, monitoringMonthlyUSD: 0,
  gpuTask: 'inference', gpuModel: 'any', gpuCount: 1, vramGb: 24, gpuHours: 100, jobCount: 1,
  allowDistributed: false, purchase: 'on-demand', retainedMonths: 1,
});

const ENUMS = {
  mode: ['general', 'gpu'], profile: ['guided', 'advanced'], workloadType: ['webapp', 'api', 'ecommerce', 'static'],
  geography: ['india', 'asia', 'world'], currency: ['USD', 'INR'], database: ['none', 'self-managed', 'managed'],
  availability: ['standard', 'high'], cpuClass: ['any', 'shared', 'dedicated'], architecture: ['x86', 'arm', 'any'],
  gpuTask: ['inference', 'training'], purchase: ['on-demand', 'spot'],
};
const ASIA = new Set(['IN', 'SG', 'JP', 'KR', 'ID', 'MY', 'TH', 'VN', 'TW', 'HK', 'PH', 'BD', 'LK']);
const isPrice = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const cents = n => Math.round((n + Number.EPSILON) * 100) / 100;
const show = n => Number(n.toFixed(4)).toLocaleString('en-US', { maximumFractionDigits: 4 });
const gbPerUnit = unit => unit === 'GiB' ? 1.073741824 : 1;

export function validateWorkload(raw = {}) {
  const value = { ...DEFAULTS, ...raw }, errors = {};
  for (const [key, choices] of Object.entries(ENUMS)) {
    if (!choices.includes(value[key])) errors[key] = 'Choose one of the available options.';
  }
  const read = (key, min, max, integer = false, blankZero = false) => {
    const item = value[key];
    const numeric = typeof item === 'number' ? item : (typeof item === 'string' && item.trim() !== '' ? Number(item) : blankZero && item === '' ? 0 : NaN);
    if (!Number.isFinite(numeric) || numeric < min || numeric > max || (integer && !Number.isInteger(numeric))) {
      errors[key] = `Enter ${integer ? 'a whole number' : 'a number'} from ${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')}.`;
    }
    value[key] = numeric;
  };
  for (const key of ['diskGb', 'transferGb', 'backupGb', 'operationsHours', 'operationsRateUSD', 'monitoringMonthlyUSD']) read(key, 0, 1e7, false, true);
  read('vcpu', 1, 4096, true); read('memoryGb', 1, 1e6);
  if (value.mode === 'general') {
    read('hours', 1 / 60, 744); read('instances', 1, 10000, true);
    read('objectGb', 0, 1e7, false, true); read('objectRequestsMillions', 0, 1e7, false, true);
    read('databaseGb', 1, 1e7);
    if (value.profile === 'guided') {
      for (const key of ['registered', 'active', 'concurrent']) read(key, 1, 1e9, true);
      if (!errors.active && !errors.registered && value.active > value.registered) errors.active = 'Active users cannot exceed registered users.';
      if (!errors.concurrent && !errors.active && value.concurrent > value.active) errors.concurrent = 'Concurrent users cannot exceed active users.';
    }
  } else {
    read('gpuCount', 1, 64, true); read('vramGb', 1, 4096); read('gpuHours', 1 / 3600, 1e6);
    read('jobCount', 1, 100000, true); read('retainedMonths', 0, 120);
    if (value.gpuHours * value.jobCount > 1e7) errors.jobCount = 'Keep total provisioned runtime below 10,000,000 hours.';
  }
  value.growthFactor = Number(value.growthFactor);
  if (![1, 2, 5].includes(value.growthFactor)) errors.growthFactor = 'Choose 1×, 2×, or 5× growth.';
  value.allowDistributed = value.allowDistributed === true || value.allowDistributed === 'true' || value.allowDistributed === 'on';
  value.gpuModel = typeof value.gpuModel === 'string' ? value.gpuModel.trim().slice(0, 80) : 'any';
  if (raw.providers !== undefined) {
    if (!Array.isArray(raw.providers) || !raw.providers.length || raw.providers.some(id => typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id))) errors.providers = 'Select at least one provider.';
    value.providers = Array.isArray(raw.providers) ? [...new Set(raw.providers)] : [];
  }
  if (raw.fxRate !== undefined && raw.fxRate !== null && raw.fxRate !== '') read('fxRate', 0.0001, 1000000);
  else delete value.fxRate;
  return { value: Object.keys(errors).length ? null : value, errors };
}

export function requirements(d) {
  let count = d.instances, vcpu = d.vcpu, memoryGb = d.memoryGb;
  const assumptions = [];
  if (d.mode === 'general' && d.profile === 'guided') {
    const weight = d.workloadType === 'ecommerce' ? 1.5 : d.workloadType === 'api' ? 0.75 : d.workloadType === 'static' ? 0.25 : 1;
    const load = d.concurrent * weight * d.growthFactor;
    count = Math.max(1, Math.ceil(load / 500));
    const perInstance = load / count;
    vcpu = perInstance <= 50 ? 1 : perInstance <= 200 ? 2 : 4;
    memoryGb = vcpu * 2;
    assumptions.push(`Guided sizing assumes ${show(load)} weighted concurrent users, up to 500 per instance: ${count} × ${vcpu} vCPU / ${memoryGb} GB. Validate with a load test; CPU counts do not establish equal performance.`);
    assumptions.push(`Monthly active users (${show(d.active * d.growthFactor)}) describe the audience; actual transfer, object requests, and runtime use the explicit inputs.`);
  } else if (d.mode === 'general') {
    count *= d.growthFactor;
    assumptions.push(`Advanced sizing uses ${count} explicitly sized instance(s). Growth multiplies instance count, aggregate storage, and traffic.`);
  }
  if (d.mode === 'general' && d.availability === 'high') count = Math.max(2, count);
  if (d.mode === 'general' && d.database === 'self-managed') {
    memoryGb += 2;
    assumptions.push('Self-managed PostgreSQL is colocated on the application VM, reserves an additional 2 GB RAM, and requires your maintenance. It is not a managed database equivalent.');
  }
  return { count, vcpu, memoryGb, assumptions };
}

function ageDays(date, now) {
  const time = Date.parse(date);
  return Number.isFinite(time) ? Math.floor((now - time) / 86400000) : Infinity;
}

function exchange(catalog, d) {
  const rates = { ...(catalog.fx?.rates || {}), USD: 1 };
  if (d.fxRate) rates.INR = d.fxRate;
  return (amount, currency) => {
    if (currency === d.currency) return amount;
    if (!(rates[currency] > 0) || !(rates[d.currency] > 0)) return null;
    return amount / rates[currency] * rates[d.currency];
  };
}

function gpuName(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(NVIDIA|AMD)/, ''); }
function matchesGpu(requested, actual) {
  const wanted = gpuName(requested), offered = gpuName(actual);
  if (wanted === offered) return true;
  // The UI's H100/A100 choices are families; never confuse L4 with L40S or infer equal throughput.
  return ['H100', 'A100'].includes(wanted) && new RegExp(`^${wanted}(?:PCIE|SXM[0-9]?|NVL)$`).test(offered);
}

function eligibility(d, offer, req) {
  const reasons = [], country = offer.region?.country;
  if (d.geography === 'india' && country !== 'IN') reasons.push('This offer is outside India.');
  if (d.geography === 'asia' && !ASIA.has(country)) reasons.push('This offer is outside the selected Asian region coverage.');
  if (d.architecture !== 'any' && offer.architecture !== d.architecture) reasons.push(`Requires ${d.architecture} CPU architecture.`);
  if (d.cpuClass !== 'any' && offer.cpuClass !== d.cpuClass) reasons.push(`Requires ${d.cpuClass} CPU capacity.`);
  if (offer.purchase !== d.purchase) reasons.push(`No ${d.purchase} price for this offer.`);
  if (d.mode === 'general') {
    if (!['vm', ...(d.workloadType === 'static' ? ['static'] : [])].includes(offer.kind)) reasons.push('Not a general-cloud compute offer.');
    if (offer.vcpu < req.vcpu || offer.memoryGb < req.memoryGb) reasons.push(`Needs at least ${req.vcpu} vCPU and ${req.memoryGb} GB RAM per instance.`);
    if (d.availability === 'high' && !(offer.region?.zoneCount >= 2)) reasons.push('Separate Availability Zones are not verified for this offer.');
  } else {
    if (offer.kind !== 'gpu' || !offer.gpu) reasons.push('No GPU hardware in this offer.');
    else {
      if (d.gpuModel !== 'any' && !matchesGpu(d.gpuModel, offer.gpu.model)) reasons.push(`Requires the ${d.gpuModel} GPU family or specified variant.`);
      if (offer.vcpu < d.vcpu || offer.memoryGb < d.memoryGb) reasons.push(`Needs at least ${d.vcpu} vCPU and ${d.memoryGb} GB host RAM.`);
      if (offer.gpu.vramGb < d.vramGb) {
        const usableCards = Math.min(d.gpuCount, offer.gpu.count);
        if (!(d.allowDistributed && offer.gpu.interconnect === true && usableCards * offer.gpu.vramGb >= d.vramGb)) reasons.push(`Requires ${d.vramGb} GB per GPU; memory is not automatically pooled.`);
      }
    }
  }
  return reasons;
}

function emptyQuote(provider, d, reasons) {
  return {
    id: `${provider.id}-unavailable`, providerId: provider.id, providerName: provider.name, color: provider.color,
    offerName: 'No matching offer', region: null, status: 'unsupported', reasons, lineItems: [], total: null, subtotal: null,
    currency: d.currency, nativeCurrency: null, nativeTotal: null, annualCost: null, hourlyCost: null, architecture: [], assumptions: [],
    sourceUrl: provider.calculatorUrl || provider.website, checkedAt: null, stale: false, capacity: 'unknown', hardware: null, savingPercent: null,
  };
}

function quoteOffer(d, catalog, provider, offer, req, now) {
  const currency = offer.price.currency, convert = exchange(catalog, d), items = [], reasons = [];
  const assumptions = [...req.assumptions, ...(offer.source?.notes ? [offer.source.notes] : [])];
  const rates = offer.rates || {}, p = offer.price;
  const count = d.mode === 'gpu' ? Math.ceil(d.gpuCount / offer.gpu.count) : req.count;
  const hours = d.mode === 'gpu' ? d.gpuHours * d.jobCount : d.hours;
  const increment = p.billingIncrementSeconds || 1;
  const billedDuration = runtime => Math.max(p.minimumBillingSeconds || 0, Math.ceil(runtime * 3600 / increment) * increment) / 3600;
  const billedHours = d.mode === 'gpu' ? billedDuration(d.gpuHours) * d.jobCount : billedDuration(hours);
  const monthFraction = d.mode === 'gpu' ? d.retainedMonths : hours / 730;
  const add = (label, amount, formula, source = offer.source.url, native = currency) => {
    const result = convert(amount, native);
    if (result === null) { reasons.push(`A verified ${native} → ${d.currency} conversion rate is missing. Enter an INR/USD reference rate when applicable.`); return; }
    items.push({ label, amount: cents(result), currency: d.currency, nativeAmount: cents(amount), nativeCurrency: native, formula, source });
  };
  const rate = (key, label, quantity, formula, { multiplier = 1 } = {}) => {
    if (quantity <= 0) return;
    if (!isPrice(rates[key])) { reasons.push(`${label} price is not verified for this offer.`); return; }
    add(label, quantity * rates[key] * multiplier, `${formula} × ${show(rates[key])} ${currency}`, rates.sources?.[key] || offer.source.url);
  };

  let compute;
  const capByRuntime = (amount, cap, hourly) => {
    if (d.mode === 'general') return Math.min(amount, cap);
    const wholeMonths = Math.floor(billedHours / 730), remainder = billedHours % 730;
    return wholeMonths * Math.min(730 * hourly, cap) + Math.min(remainder * hourly, cap);
  };
  if (isPrice(p.hourly)) {
    compute = billedHours * p.hourly;
    if (isPrice(p.monthlyCap)) compute = capByRuntime(compute, p.monthlyCap, p.hourly);
    if (isPrice(p.minimumCharge)) compute = Math.max(compute, p.minimumCharge * (d.mode === 'gpu' ? d.jobCount : 1));
    if (d.mode === 'gpu' && p.billingUnit === 'gpu-hour') compute *= offer.gpu.count;
  } else if (isPrice(p.monthly)) {
    compute = p.monthly * Math.max(1, Math.ceil(d.mode === 'gpu' ? billedHours / 730 : hours / 744));
    assumptions.push('This offer has a monthly minimum: shorter runtime does not reduce the base fee.');
  } else reasons.push('Compute price is not verified.');
  if (compute !== undefined) add(d.mode === 'gpu' ? 'GPU instances' : 'Compute', compute * count,
    `${count} instance(s) × ${show(billedHours)} billed hours${isPrice(p.hourly) ? ` × ${p.hourly} ${currency}/${p.billingUnit === 'gpu-hour' ? 'GPU-hour' : 'instance-hour'}` : `; monthly minimum ${p.monthly} ${currency}`}${isPrice(p.monthlyCap) ? `; cap ${p.monthlyCap} ${currency} per instance/month` : ''}`);
  const databaseDisk = d.mode === 'general' && d.database === 'self-managed' ? d.databaseGb * d.growthFactor : 0;
  const extraDisk = Math.max(0, d.diskGb + databaseDisk - (p.includedDiskGb || 0) * gbPerUnit(p.diskUnit)) / gbPerUnit(rates.diskUnit);
  const diskUnit = rates.diskUnit || 'GB';
  if (isPrice(rates.diskMaxGb) && extraDisk > rates.diskMaxGb) {
    reasons.push('Requested persistent disk exceeds the verified storage price band.');
  } else if (extraDisk > 0 && Array.isArray(rates.diskTiers)) {
    const tier = rates.diskTiers.find(t => t.upToGb >= extraDisk);
    if (!tier || !isPrice(tier.monthly)) reasons.push('Requested disk size exceeds the verified disk pricing tiers.');
    else add('Additional persistent disk', tier.monthly * count * monthFraction, `${count} × ${tier.upToGb} ${diskUnit} provisioned disk tier × ${show(monthFraction)} month(s)`, rates.sources?.diskGbMonth || offer.source.url);
  } else {
    const minimum = rates.diskMinimumGb || 0, step = rates.diskIncrementGb || 1;
    const provisionedDisk = extraDisk > 0 ? Math.ceil(Math.max(minimum, extraDisk) / step) * step : 0;
    rate('diskGbMonth', 'Additional persistent disk', provisionedDisk * count * monthFraction, `${show(provisionedDisk)} provisioned ${diskUnit} beyond included disk × ${count} instance(s) × ${show(monthFraction)} month(s)`);
  }
  if (d.mode === 'gpu' && d.retainedMonths === 0 && extraDisk > 0) reasons.push('Persistent disk retention must be greater than zero when additional disk is requested.');
  if (d.mode === 'gpu' && monthFraction * 730 < hours && extraDisk > 0) reasons.push('Disk retention is shorter than the provisioned compute runtime.');
  if (isPrice(rates.ipv4Hour) && isPrice(rates.ipv4MonthlyCap)) {
    const ipCost = capByRuntime(billedHours * rates.ipv4Hour, rates.ipv4MonthlyCap, rates.ipv4Hour);
    add('Public IPv4', ipCost * count, `${count} address(es) × ${show(billedHours)} hours × ${rates.ipv4Hour} ${currency}; ${rates.ipv4MonthlyCap} ${currency} per-address monthly cap`, rates.sources?.ipv4Hour || offer.source.url);
  } else rate('ipv4Hour', 'Public IPv4', billedHours * count, `${count} address(es) × ${show(billedHours)} billed hours`);
  const transfer = d.transferGb * d.growthFactor;
  // Included transfer is per instance and accrues with its billed lifetime, capped at a month.
  const accrualHours = p.transferAccrualHours || 730;
  const allowanceFactor = Math.min(1, hours / accrualHours);
  const includedTransfer = (p.includedTransferGb || 0) * gbPerUnit(p.transferUnit) * count * allowanceFactor + (rates.freeEgressGb || 0) * gbPerUnit(rates.egressUnit);
  const overage = Math.max(0, transfer - includedTransfer) / gbPerUnit(rates.egressUnit);
  const egressUnit = rates.egressUnit || 'GB';
  if (isPrice(rates.egressMaxGb) && overage > rates.egressMaxGb) {
    reasons.push('Outbound transfer exceeds the verified price band. Higher-volume tiers need a verified rate.');
  } else if (overage > 0 && Array.isArray(rates.egressTiers)) {
    let remaining = overage, start = 0, cost = 0;
    for (const tier of rates.egressTiers) {
      const width = tier.upToGb === null ? Infinity : tier.upToGb - start;
      const used = Math.min(remaining, width);
      if (!isPrice(tier.rate) || width < 0) { reasons.push('Invalid transfer tier data.'); break; }
      cost += used * tier.rate; remaining -= used; start = tier.upToGb;
      if (remaining <= 0) break;
    }
    if (remaining > 0) reasons.push('Transfer exceeds the verified pricing tiers.');
    else add('Outbound transfer', cost, `${show(transfer)} GB outbound − ${show(includedTransfer)} GB allowance; graduated transfer tiers in ${egressUnit}`, rates.sources?.egressGb || offer.source.url);
  } else rate('egressGb', 'Outbound transfer', overage, `${show(overage)} billable ${egressUnit} (${show(transfer)} GB outbound − ${show(includedTransfer)} GB included)`);
  assumptions.push(`${show(includedTransfer)} GB outbound allowance modeled for this scenario. Existing account usage can consume shared allowances; inbound, cross-region, and inter-zone traffic are excluded.`);

  if (d.mode === 'general') {
    rate('objectGbMonth', 'Object storage', d.objectGb * d.growthFactor * monthFraction, `${show(d.objectGb * d.growthFactor)} GB × ${show(monthFraction)} month(s)`);
    rate('objectRequestsMillion', 'Object requests', d.objectRequestsMillions * d.growthFactor, `${show(d.objectRequestsMillions * d.growthFactor)} million requests`);
    if (d.database === 'managed') {
      const dbRate = rates.managedDbMonth;
      if (!isPrice(dbRate) || !offer.managedDatabase || offer.managedDatabase.storageGb < d.databaseGb * d.growthFactor || (d.availability === 'high' && !offer.managedDatabase.highAvailability)) reasons.push('A managed PostgreSQL plan matching the requested storage and availability is not verified.');
      else add('Managed PostgreSQL', dbRate * monthFraction, `${offer.managedDatabase.name}; ${show(monthFraction)} month(s)`, rates.sources?.managedDbMonth || offer.source.url);
    }
    if (d.availability === 'high') {
      rate('loadBalancerHour', 'Load balancer', billedHours, `${show(billedHours)} hours; traffic-based charges need verification`);
      if (!offer.loadBalancerIncludesTraffic && isPrice(rates.loadBalancerHour)) reasons.push('Load-balancer traffic/capacity charges are not fully verified.');
      if (d.database === 'self-managed') reasons.push('Self-managed database failover and replication costs are not covered.');
      assumptions.push('Requires stateless application replicas, verified separate zones, health checks, deployment design, and failover testing.');
    }
  }
  rate('backupGbMonth', 'Backup storage', d.backupGb * d.growthFactor * monthFraction, `${show(d.backupGb * d.growthFactor)} GB × ${show(monthFraction)} month(s)`);
  if (d.operationsHours * d.operationsRateUSD > 0) add('Operating effort', d.operationsHours * d.operationsRateUSD * (d.mode === 'gpu' ? monthFraction : 1), 'User-supplied hours × USD hourly operating rate', null, 'USD');
  if (d.monitoringMonthlyUSD > 0) add('Monitoring allowance', d.monitoringMonthlyUSD * monthFraction, `${show(monthFraction)} month(s) × user-supplied USD allowance`, null, 'USD');

  const days = ageDays(offer.source.checkedAt, now), stale = days > 30;
  if (!offer.verified) reasons.push('This price has not been verified against its source.');
  if (offer.regionalPricingVerified === false) reasons.push('Published reference rate: the exact regional price or SKU availability has not been verified. Confirm a regional quote before choosing this offer.');
  if (days > 90 || days < -1) reasons.push('Pricing is outside the 90-day verification window. Refresh this offer before ranking.');
  if (stale) assumptions.push('Price source was checked more than 30 days ago; verify it before making a purchase.');
  const manualFXApplies = d.fxRate && ['USD', 'INR'].includes(currency) && ['USD', 'INR'].includes(d.currency);
  if (manualFXApplies && d.currency !== currency) assumptions.push(`Currency conversion uses your supplied ${d.fxRate} INR/USD rate. It is a display conversion, not a provider local-currency tariff.`);
  else if (d.currency !== currency) {
    assumptions.push(`Display conversion uses the reference exchange-rate snapshot dated ${catalog.fx?.asOf || 'unknown'}; provider local-currency tariffs can differ.`);
    if (ageDays(catalog.fx?.asOf, now) > 30) reasons.push('The exchange-rate snapshot is missing or over 30 days old. Enter a current reference rate.');
  }
  assumptions.push('Taxes, support plans, free credits, commitments, migration work, DNS, NAT, WAF, unlisted services, and usage beyond this configuration are excluded.');
  assumptions.push('Capacity is unknown. A listed price is not a reservation or guarantee of availability.');
  if (offer.cpuClass === 'shared') assumptions.push('Shared CPU capacity is subject to contention or bursting limits; compare sustained performance in a benchmark.');
  if (d.mode === 'gpu') {
    assumptions.push(`Provisioned runtime is ${show(d.gpuHours)} hours per job × ${d.jobCount} job(s); idle time during that runtime is billed. Runtime is supplied by you, not predicted from GPU names.`);
    assumptions.push(`${count} whole instance(s), ${count * offer.gpu.count} GPU(s) purchased for ${d.gpuCount} requested. ${show(offer.gpu.vramGb)} GB VRAM per GPU.`);
    if (d.allowDistributed) assumptions.push('Memory aggregation requires a compatible distributed runtime and the documented interconnect; pooling is never automatic.');
    if (isPrice(p.monthlyCap) || !isPrice(p.hourly)) assumptions.push('Multi-month compute uses sequential runtime and 730-hour planning months. Disk retention does not determine compute duration; calendar billing dates can change actual capped charges.');
  }
  const uniqueReasons = [...new Set(reasons)], subtotal = cents(items.reduce((sum, item) => sum + item.amount, 0));
  const complete = uniqueReasons.length === 0;
  const nativeTotal = items.every(item => item.nativeCurrency === currency) ? cents(items.reduce((sum, item) => sum + item.nativeAmount, 0)) : null;
  return {
    id: offer.id, providerId: provider.id, providerName: provider.name, color: provider.color, offerName: offer.name, region: offer.region,
    status: complete ? 'complete' : 'partial', reasons: uniqueReasons, lineItems: items, total: complete ? subtotal : null, subtotal,
    currency: d.currency, nativeCurrency: currency, nativeTotal: complete ? nativeTotal : null,
    annualCost: complete && d.mode === 'general' ? cents(subtotal * 12) : null,
    hourlyCost: complete ? cents(subtotal / hours) : null,
    architecture: d.mode === 'gpu' ? ['Dataset / requests', `${count} × ${offer.name}`, 'Persistent storage / outputs'] : [
      'Users', ...(d.availability === 'high' ? ['Load balancer'] : []), `${count} × ${offer.name}${d.workloadType === 'static' ? ' · static files' : ''}`,
      ...(d.database !== 'none' ? [d.database === 'managed' ? 'Managed PostgreSQL' : 'Self-managed PostgreSQL'] : []), ...(d.objectGb > 0 ? ['Object storage'] : []),
    ], assumptions, sourceUrl: offer.source.url, checkedAt: offer.source.checkedAt, stale, capacity: 'unknown',
    hardware: { vcpu: offer.vcpu, memoryGb: offer.memoryGb, gpu: offer.gpu || null, instances: count, cpuClass: offer.cpuClass, architecture: offer.architecture },
    savingPercent: null,
  };
}

export function compare(raw, catalog, { now = new Date() } = {}) {
  const parsed = validateWorkload(raw);
  if (!parsed.value) throw new TypeError(`Invalid workload: ${Object.entries(parsed.errors).map(([key, message]) => `${key}: ${message}`).join(' ')}`);
  const d = parsed.value, req = requirements(d), warnings = [];
  const selected = catalog.providers.filter(p => !d.providers || d.providers.includes(p.id));
  const quotes = selected.map(provider => {
    const offers = catalog.offers.filter(offer => offer.provider === provider.id && (d.mode === 'gpu' ? offer.kind === 'gpu' : offer.kind === 'vm' || offer.kind === 'static'));
    const matching = offers.filter(offer => eligibility(d, offer, req).length === 0);
    if (!matching.length) {
      const notes = catalog.coverage?.filter(c => c.provider === provider.id && c.kind === (d.mode === 'gpu' ? 'gpu' : 'vm')).map(c => c.reason) || [];
      const mismatches = [...new Set(offers.flatMap(offer => eligibility(d, offer, req)))];
      return emptyQuote(provider, d, notes.length || mismatches.length ? [...notes, ...mismatches] : ['No verified offer is available in this pricing snapshot for the selected workload.']);
    }
    const candidates = matching.map(offer => quoteOffer(d, catalog, provider, offer, req, new Date(now)));
    candidates.sort((a, b) => (a.status === 'complete' ? 0 : 1) - (b.status === 'complete' ? 0 : 1) || a.reasons.length - b.reasons.length || (a.total ?? a.subtotal) - (b.total ?? b.subtotal) || a.id.localeCompare(b.id));
    return candidates[0];
  });
  const order = { complete: 0, partial: 1, unsupported: 2 };
  quotes.sort((a, b) => order[a.status] - order[b.status] || (a.total ?? Infinity) - (b.total ?? Infinity) || a.providerName.localeCompare(b.providerName));
  const complete = quotes.filter(q => q.status === 'complete'), best = complete[0] || null;
  const largest = complete.length > 1 ? Math.max(...complete.map(q => q.total)) : null;
  for (const quote of complete) quote.savingPercent = largest > 0 ? cents((largest - quote.total) / largest * 100) : null;
  if (!best) warnings.push('No complete comparable estimate meets every requirement. Review coverage gaps or adjust the configuration.');
  if (quotes.some(q => q.stale)) warnings.push('Some prices are over 30 days old. Check source pages before choosing a provider.');
  if (d.mode === 'general' && d.availability === 'standard') warnings.push('Standard estimates do not include automatic failover or a managed availability guarantee.');
  if (d.purchase === 'spot') warnings.push('Spot capacity is interruptible. Checkpointing, retries, and replacement costs are not modeled.');
  return { quotes, best, snapshotId: catalog.id, publishedAt: catalog.publishedAt, input: d, warnings };
}
