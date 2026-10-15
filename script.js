import { validateWorkload, compare } from './lib/engine.js';

import { validateCatalog, catalogFreshness } from './lib/catalog.js';

const $ = id => document.getElementById(id);
const form = $('usage-form');
const state = { catalog: null, catalogWarnings: [], result: null, selectedId: null, dirty: false, saved: [], printState: null, activeMode: 'general', modeDrafts: {}, modePreset: { general: 'webapp', gpu: 'inference' }, activeScenarioId: null, deletedScenario: null, detailInline: false };
const STORAGE_KEY = 'viviz-cloud-scenarios-v1';
const statusText = { complete: 'Complete estimate', partial: 'Total needs verification', unsupported: 'Outside current catalog' };
const number = value => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
const money = (value, currency = 'USD') => typeof value === 'number' && Number.isFinite(value)
  ? new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  : '—';
const date = value => {
  const parsed = new Date(value);
  return value && Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(parsed) : 'Not recorded';
};
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};
function sourceLink(value, label) {
  const raw = typeof value === 'object' && value !== null ? value.url : value;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const link = make('a', label || url.hostname, 'source-link');
    link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    return link;
  } catch { return null; }
}
const mode = () => form.elements.namedItem('mode').value;
const modeFields = {
  general: ['profile', 'workloadType', 'registered', 'active', 'concurrent', 'vcpu', 'memoryGb', 'instances', 'hours', 'diskGb', 'transferGb', 'objectGb', 'database', 'databaseGb', 'availability', 'cpuClass', 'architecture', 'objectRequestsMillions', 'backupGb', 'operationsHours', 'operationsRateUSD', 'monitoringMonthlyUSD', 'growthFactor'],
  gpu: ['gpuTask', 'gpuModel', 'gpuCount', 'vramGb', 'gpuHours', 'jobCount', 'purchase', 'retainedMonths', 'allowDistributed', 'vcpu', 'memoryGb', 'diskGb', 'transferGb', 'cpuClass', 'architecture', 'backupGb', 'operationsHours', 'operationsRateUSD', 'monitoringMonthlyUSD'],
};
function fieldValues(selectedMode) {
  return Object.fromEntries(modeFields[selectedMode].map(name => {
    const control = form.elements.namedItem(name);
    return [name, control.type === 'checkbox' ? control.checked : control.value];
  }));
}
const modeDefaults = { general: fieldValues('general'), gpu: fieldValues('gpu') };
function updatePlannerSummaries() {
  $('general-summary').textContent = $('profile').value === 'guided' ? 'Guided ' + $('workloadType').selectedOptions[0].textContent.toLowerCase() : $('instances').value + ' instance(s) · ' + $('vcpu').value + ' vCPU';
  $('resource-summary').textContent = $('diskGb').value + ' GB disk · ' + $('transferGb').value + ' GB outbound';
  $('provider-summary').textContent = form.querySelectorAll('[name="providers"]:checked').length + ' selected';
}

function syncFields() {
  const selectedMode = mode();
  form.querySelectorAll('[data-mode]').forEach(node => { node.hidden = node.dataset.mode !== selectedMode; });
  const explicit = selectedMode === 'gpu' || $('profile').value === 'advanced';
  $('audience-fields').hidden = explicit;
  form.querySelectorAll('.resource-explicit').forEach(node => {
    node.hidden = !explicit || (node.dataset.mode && node.dataset.mode !== selectedMode);
  });
  $('database-size-field').hidden = selectedMode !== 'general' || $('database').value === 'none';
  $('growthFactor').closest('.field').hidden = selectedMode === 'gpu';
  $('objectGb').closest('.field').hidden = selectedMode === 'gpu';
  $('objectRequestsMillions').closest('.field').hidden = selectedMode === 'gpu';
  for (const option of $('preset').options) {
    if (option.value === 'custom') continue;
    option.hidden = presets[option.value]?.mode !== selectedMode;
    option.disabled = option.hidden;
  }
  updatePlannerSummaries();
}
function readRaw() {
  const values = Object.fromEntries(new FormData(form));
  values.providers = Array.from(form.querySelectorAll('[name="providers"]:checked'), input => input.value);
  values.allowDistributed = $('allowDistributed').checked;
  if (values.fxRate === '') delete values.fxRate;
  if (values.mode === 'gpu') {
    values.profile = 'advanced';
    values.growthFactor = 1;
    values.objectGb = 0; values.objectRequestsMillions = 0;
    values.database = 'none'; values.availability = 'standard';
  } else {
    values.purchase = 'on-demand';
    if (values.profile === 'guided') { values.vcpu = 2; values.memoryGb = 4; values.instances = 1; }
    if (values.database === 'none') values.databaseGb = 20;
  }
  return values;
}
function showErrors(errors, focus) {
  form.querySelectorAll('.error').forEach(node => { node.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
  let first = null;
  const messages = Object.entries(errors || {});
  for (const [key, message] of messages) {
    let error = $(key + '-error');
    const input = $(key) || form.querySelector('[name="' + key + '"]');
    if (!error && input) {
      error = make('span', '', 'error'); error.id = key + '-error';
      input.closest('.field')?.append(error);
    }
    if (error) error.textContent = message;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      const described = new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
      if (error) described.add(error.id);
      input.setAttribute('aria-describedby', Array.from(described).join(' '));
      if (!first) first = input;
    }
  }
  $('form-status').textContent = messages.length ? 'Correct the highlighted fields to compare. ' + (!first ? messages.map(([, message]) => message).join(' ') : '') : '';
  if (focus && first) {
    for (const detail of form.querySelectorAll('.planner-accordion')) if (detail.contains(first)) detail.open = true;
    for (const detail of form.querySelectorAll('details')) if (detail.contains(first)) detail.open = true;
    first.focus();
  }
  return messages.length === 0;
}
function setDirty(value) {
  state.dirty = value;
  $('edited-notice').hidden = !value || !state.result;
  $('save-scenario').disabled = value || !state.result;
  $('save-as-scenario').disabled = value || !state.result;
  $('compare-button').firstChild.textContent = value ? 'Update estimate ' : 'Compare providers ';
  $('recommendation-card').classList.toggle('stale', value && !!state.result);
  $('comparison-table-wrap').classList.toggle('stale', value && !!state.result);
  $('comparison-list').classList.toggle('stale', value && !!state.result);
  $('best-label').textContent = value ? 'PREVIOUS ESTIMATE · UPDATE REQUIRED' : state.result?.best ? 'LOWEST ESTIMATED COST MEETING YOUR REQUIREMENTS' : 'NO COMPLETE COMPARABLE ESTIMATE';
}
function markDirty() {
  if (state.result) setDirty(true);
}

const presets = {
  webapp: { mode: 'general', profile: 'guided', workloadType: 'webapp', registered: 10000, active: 2000, concurrent: 100, vcpu: 2, memoryGb: 4, instances: 1, diskGb: 40, objectGb: 0, transferGb: 200, database: 'none', availability: 'standard', growthFactor: 1 },
  api: { mode: 'general', profile: 'guided', workloadType: 'api', registered: 50000, active: 10000, concurrent: 250, vcpu: 2, memoryGb: 4, instances: 1, diskGb: 40, objectGb: 0, transferGb: 500, database: 'none', availability: 'standard', growthFactor: 1 },
  static: { mode: 'general', profile: 'guided', workloadType: 'static', registered: 10000, active: 2000, concurrent: 100, vcpu: 1, memoryGb: 2, instances: 1, diskGb: 20, objectGb: 0, transferGb: 200, database: 'none', availability: 'standard', growthFactor: 1 },
  ecommerce: { mode: 'general', profile: 'guided', workloadType: 'ecommerce', registered: 20000, active: 5000, concurrent: 150, vcpu: 4, memoryGb: 8, instances: 1, diskGb: 80, objectGb: 50, transferGb: 500, database: 'managed', databaseGb: 40, availability: 'standard', growthFactor: 1 },
  inference: { mode: 'gpu', gpuTask: 'inference', gpuModel: 'A100 PCIe', gpuCount: 1, vramGb: 24, gpuHours: 100, jobCount: 1, vcpu: 4, memoryGb: 16, diskGb: 40, objectGb: 0, transferGb: 200, retainedMonths: 1, purchase: 'on-demand', allowDistributed: false },
  training: { mode: 'gpu', gpuTask: 'training', gpuModel: 'H100 PCIe', gpuCount: 1, vramGb: 80, gpuHours: 12, jobCount: 1, vcpu: 8, memoryGb: 32, diskGb: 100, retainedMonths: 1, purchase: 'on-demand', allowDistributed: false },
};
function applyValues(values) {
  for (const [name, value] of Object.entries(values)) {
    if (name === 'providers' && Array.isArray(value)) {
      form.querySelectorAll('[name="providers"]').forEach(input => { input.checked = value.includes(input.value); });
      continue;
    }
    const control = form.elements.namedItem(name);
    if (!control) continue;
    if (name === 'mode') {
      form.querySelectorAll('[name="mode"]').forEach(input => { input.checked = input.value === value; });
    } else if (control.type === 'checkbox') control.checked = value === true;
    else control.value = value === null || value === undefined ? '' : value;
  }
  syncFields();
}
function applyPreset(name) {
  if (!presets[name]) return;
  state.modeDrafts[state.activeMode] = fieldValues(state.activeMode);
  const selectedMode = presets[name].mode;
  applyValues({ ...modeDefaults[selectedMode], ...presets[name] });
  state.activeMode = selectedMode;
  state.modePreset[selectedMode] = name;
  state.modeDrafts[selectedMode] = fieldValues(selectedMode);
  showErrors({}, false);
  markDirty();
}
function runComparison({ focusErrors = false, announce = true, focusResults = false } = {}) {
  if (!state.catalog) return false;
  const parsed = validateWorkload(readRaw());
  if (!showErrors(parsed.errors, focusErrors) || !parsed.value) return false;
  try {
    const result = compare(parsed.value, state.catalog);
    state.result = result;
    const stillPresent = result.quotes.some(quote => quote.id === state.selectedId);
    if (!stillPresent) state.selectedId = result.best?.id || result.quotes.find(quote => quote.status !== 'unsupported')?.id || result.quotes[0]?.id;
    state.modeDrafts[mode()] = fieldValues(mode());
    setDirty(false);
    render();
    if (focusResults && window.matchMedia('(max-width: 680px)').matches) {
      $('comparison-heading').tabIndex = -1;
      $('comparison-heading').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      $('comparison-heading').focus({ preventScroll: true });
    }
    if (announce) $('result-live').textContent = result.best
      ? result.best.providerName + ' has the lowest complete estimate at ' + money(result.best.total, result.best.currency) + '. ' + result.quotes.filter(quote => quote.status === 'complete').length + ' complete estimates.'
      : 'Comparison updated. No complete estimate meets all requirements. Review the missing prices and coverage.';
    return true;
  } catch (error) {
    $('form-status').textContent = 'The comparison could not be calculated. Check your inputs or retry loading the pricing snapshot.';
    console.error('Comparison failed', error);
    return false;
  }
}

function quoteDescription(quote) {
  const hardware = quote.hardware;
  if (!hardware) return quote.offerName || '';
  const parts = [quote.offerName, number(hardware.vcpu) + ' vCPU', number(hardware.memoryGb) + ' GB RAM'];
  if (hardware.gpu) parts.push((hardware.gpu.count || 1) + ' × ' + hardware.gpu.model, number(hardware.gpu.vramGb) + ' GB VRAM / GPU');
  if (hardware.instances) parts.push(hardware.instances + ' instance' + (hardware.instances === 1 ? '' : 's'));
  if (hardware.cpuClass) parts.push(hardware.cpuClass + ' CPU');
  if (hardware.architecture) parts.push(hardware.architecture);
  return parts.filter(Boolean).join(' · ');
}
function periodLabel() {
  return state.result.input.mode === 'gpu' ? 'for all jobs + retained storage' : 'per month';
}
function render() {
  const result = state.result;
  $('load-state').hidden = true; $('result-content').hidden = false;
  const best = result.best;
  $('recommendation-card').classList.toggle('no-best', !best);
  $('best-label').textContent = best ? 'LOWEST ESTIMATED COST MEETING YOUR REQUIREMENTS' : 'NO COMPLETE COMPARABLE ESTIMATE';
  $('best-provider').textContent = best ? best.providerName : 'Review the coverage gaps';
  $('best-description').textContent = best ? best.offerName + ' · ' + (best.region?.name || 'Region not recorded') : 'Partial estimates show known charges. Missing prices must be verified before choosing a provider.';
  const alternative = result.quotes.filter(quote => quote.status === 'complete' && quote.id !== best?.id).sort((a, b) => a.total - b.total)[0];
  $('best-alternative').textContent = best && alternative ? 'Closest complete alternative: ' + alternative.providerName + ' · +' + money(alternative.total - best.total, best.currency) + ' for the same inputs.' : '';
  $('best-cost').textContent = best ? money(best.total, best.currency) : '';
  $('best-period').textContent = best ? periodLabel() : '';
  $('best-secondary').textContent = best
    ? (result.input.mode === 'general' ? money(best.annualCost, best.currency) + ' annualized' : number(result.input.gpuHours) + ' hours / job × ' + number(result.input.jobCount) + ' job(s)')
    : '';
  $('gpu-comparison-note').hidden = result.input.mode !== 'gpu';
  const input = result.input;
  const geography = { india: 'India only', asia: 'India + nearby Asia', world: 'Worldwide' }[input.geography];
  const sizing = input.mode === 'gpu'
    ? input.gpuCount + ' × ' + (input.gpuModel === 'any' ? 'eligible GPU' : input.gpuModel) + ' · minimum ' + input.vramGb + ' GB VRAM / GPU · ' + number(input.gpuHours) + ' hours × ' + input.jobCount + ' job(s) · ' + input.retainedMonths + ' month(s) storage'
    : (input.profile === 'guided' ? number(input.concurrent) + ' peak concurrent users · guided sizing' : input.instances + ' instance(s) · minimum ' + input.vcpu + ' vCPU / ' + input.memoryGb + ' GB RAM') + ' · ' + number(input.hours) + ' hours/month · ' + input.growthFactor + '× growth · ' + input.database + ' database';
  $('workload-summary').textContent = 'Calculated for: ' + geography + ' · ' + sizing + ' · ' + number(input.transferGb) + ' GB base outbound transfer.';
  const counts = { complete: 0, partial: 0, unsupported: 0 };
  result.quotes.forEach(quote => { counts[quote.status]++; });
  $('comparison-summary').textContent = counts.complete + ' complete · ' + counts.partial + ' partial · ' + counts.unsupported + ' outside catalog';
  const warnings = $('report-warnings'); warnings.replaceChildren();
  [...new Set([...(result.warnings || []), ...state.catalogWarnings])].forEach(warning => warnings.append(make('p', warning)));
  warnings.hidden = !warnings.childElementCount;
  $('snapshot-footnote').textContent = 'Pricing snapshot ' + result.snapshotId + ' · published ' + date(result.publishedAt) + '. All estimates exclude taxes and unlisted services. Exported reports retain this snapshot ID.';
  renderCards(); renderDetail(); renderSaved(); setDirty(false);
}
function sortedQuotes() {
  const quotes = [...state.result.quotes], selectedSort = $('sort').value;
  const rank = { complete: 0, partial: 1, unsupported: 2 };
  return quotes.sort((a, b) => {
    if (selectedSort === 'provider') return a.providerName.localeCompare(b.providerName);
    const statusDifference = rank[a.status] - rank[b.status];
    if (statusDifference) return statusDifference;
    const aCost = a.total ?? a.subtotal ?? 0, bCost = b.total ?? b.subtotal ?? 0;
    return (selectedSort === 'highest' ? bCost - aCost : aCost - bCost) || a.providerName.localeCompare(b.providerName);
  });
}
function selectQuote(quote) {
  state.selectedId = quote.id;
  state.detailInline = window.matchMedia('(max-width: 850px)').matches;
  if (quote.status !== 'complete') $('coverage-details').open = true;
  renderCards(); renderDetail();
  $('quote-detail').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  $('detail-heading').tabIndex = -1; $('detail-heading').focus({ preventScroll: true });
}
function detailButton(quote) {
  const button = make('button', 'View details', 'detail-button');
  button.type = 'button'; button.setAttribute('aria-controls', 'quote-detail');
  button.setAttribute('aria-label', 'View ' + quote.providerName + ' configuration and pricing details');
  button.addEventListener('click', () => selectQuote(quote));
  return button;
}
function placeDetail() {
  const detail = $('quote-detail');
  $('detail-home').append(detail);
  if (state.detailInline && window.matchMedia('(max-width: 850px)').matches) {
    const selected = document.querySelector('[data-quote-id="' + CSS.escape(state.selectedId || '') + '"]');
    if (selected) selected.append(detail);
  }
}
function renderCards() {
  $('detail-home').append($('quote-detail'));
  const list = $('comparison-list'), gaps = $('coverage-list'), rows = $('comparison-table-body');
  list.replaceChildren(); gaps.replaceChildren(); rows.replaceChildren();
  const complete = state.result.quotes.filter(quote => quote.status === 'complete');
  const maxCost = Math.max(1, ...complete.map(quote => quote.total));
  for (const quote of sortedQuotes()) {
    const isBest = state.result.best?.id === quote.id;
    const card = make('article', null, 'provider-card' + (isBest ? ' best' : '') + (quote.id === state.selectedId ? ' selected' : '') + (quote.status === 'unsupported' ? ' unavailable' : ''));
    card.dataset.quoteId = quote.id;
    const main = make('div', null, 'provider-main'), info = make('div'), title = make('div', null, 'provider-title'), marker = make('span', '', 'provider-marker');
    marker.setAttribute('aria-hidden', 'true');
    if (/^#[0-9a-f]{6}$/i.test(quote.color || '')) marker.style.backgroundColor = quote.color;
    title.append(marker, make('h3', quote.providerName));
    if (isBest) title.append(make('span', 'LOWEST COST', 'best-tag'));
    info.append(title);
    if (quote.region) info.append(make('p', quote.region.name + ' · ' + quote.region.country, 'provider-location'));
    if (quote.status !== 'unsupported') info.append(make('p', quoteDescription(quote), 'provider-config'));
    const cost = make('div', null, 'provider-cost');
    if (quote.status === 'complete') {
      cost.append(make('strong', money(quote.total, quote.currency)), make('small', periodLabel()));
      if (!isBest && state.result.best) cost.append(make('small', '+' + money(quote.total - state.result.best.total, quote.currency) + ' vs lowest'));
    } else if (quote.status === 'partial') {
      cost.append(make('span', statusText.partial, 'status-pill partial'), make('small', quote.lineItems.length ? money(quote.subtotal, quote.currency) + ' known charges; total unknown' : 'No priced components'));
    } else cost.append(make('strong', statusText.unsupported), make('small', 'No eligible offer in this snapshot'));
    main.append(info, cost); card.append(main);
    if (quote.reasons?.length) card.append(make('p', quote.reasons.slice(0, 2).join(' ') + (quote.reasons.length > 2 ? ' +' + (quote.reasons.length - 2) + ' more in details.' : ''), 'provider-reason'));
    const bottom = make('div', null, 'provider-bottom');
    if (quote.status === 'complete') {
      const scale = make('div', null, 'cost-scale'), fill = make('span');
      scale.setAttribute('aria-hidden', 'true'); fill.style.width = Math.max(2, quote.total / maxCost * 100) + '%'; scale.append(fill); bottom.append(scale);
    } else bottom.append(make('span', statusText[quote.status], 'status-pill ' + quote.status));
    bottom.append(detailButton(quote)); card.append(bottom);
    if (quote.status === 'complete') {
      list.append(card);
      const row = make('tr', null, isBest ? 'best-row' : '');
      if (quote.id === state.selectedId) row.classList.add('selected-row');
      const provider = make('td'), config = make('td'), included = make('td'), total = make('td'), action = make('td');
      provider.append(make('strong', quote.providerName), make('small', quote.region ? quote.region.name + ' · ' + quote.region.country : 'Region unrecorded'));
      config.append(make('strong', quote.offerName), make('small', quoteDescription(quote).replace(quote.offerName + ' · ', '')));
      const offer = state.catalog.offers.find(item => item.id === quote.id);
      const disk = offer?.price?.includedDiskGb || 0, transfer = offer?.price?.includedTransferGb || 0;
      included.append(make('span', disk ? number(disk) + ' GB disk' : 'Disk billed separately'), make('small', transfer ? number(transfer) + ' GB transfer' : 'Transfer billed separately'));
      total.append(make('strong', money(quote.total, quote.currency)), make('small', isBest ? 'Lowest complete estimate' : '+' + money(quote.total - state.result.best.total, quote.currency) + ' vs lowest'));
      action.append(detailButton(quote)); row.append(provider, config, included, total, action); rows.append(row);
    } else gaps.append(card);
  }
  $('comparison-table-wrap').hidden = !complete.length;
  $('bundle-note').hidden = !complete.length;
  $('coverage-details').hidden = !gaps.childElementCount;
  if (!complete.length && gaps.childElementCount) $('coverage-details').open = true;
  $('coverage-summary').textContent = gaps.childElementCount + ' provider' + (gaps.childElementCount === 1 ? '' : 's') + ' need verification or fall outside this catalog';
  placeDetail();
}
function renderDetail() {
  const quote = state.result.quotes.find(item => item.id === state.selectedId);
  $('quote-detail').hidden = !quote;
  if (!quote) return;
  $('detail-heading').textContent = quote.providerName + (quote.status === 'unsupported' ? ' · coverage' : ' · ' + quote.offerName);
  $('detail-region').textContent = quote.region ? quote.region.name + ' · ' + quoteDescription(quote) : 'No eligible offer was found for your requirements.';
  $('detail-status').textContent = statusText[quote.status]; $('detail-status').className = 'status-pill ' + quote.status;
  $('detail-reasons').textContent = (quote.reasons || []).join(' ');
  $('detail-reasons').hidden = !quote.reasons?.length;
  const flow = $('architecture-flow'); flow.replaceChildren();
  (quote.architecture || []).forEach((step, index) => {
    if (index) flow.append(make('b', '→'));
    flow.append(make('span', typeof step === 'string' ? step : step.label || step.name || ''));
  });
  flow.hidden = !flow.childElementCount;
  const rows = $('line-items'); rows.replaceChildren();
  for (const item of quote.lineItems || []) {
    const row = make('tr'), label = make('td'), amount = make('td', money(item.amount, item.currency || quote.currency));
    label.append(make('strong', item.label));
    const detail = make('details', null, 'calculation');
    detail.append(make('summary', 'Calculation & source'), make('p', item.formula || 'See provider pricing source.'));
    const link = sourceLink(item.source, 'Official pricing source ↗');
    if (link) detail.append(link);
    else if (item.source === null) detail.append(make('p', 'User-supplied operating budget.'));
    label.append(detail); row.append(label, amount); rows.append(row);
  }
  if (!rows.childElementCount) {
    const cell = make('td', 'No priced components are available for this configuration.'); cell.colSpan = 2;
    const row = make('tr'); row.append(cell); rows.append(row);
  }
  $('detail-total-label').textContent = quote.status === 'complete' ? 'Estimated total · ' + periodLabel() : 'Known charges · total incomplete';
  $('detail-total').textContent = quote.status === 'unsupported' || !quote.lineItems.length ? '—' : money(quote.total ?? quote.subtotal, quote.currency);
  const assumptions = $('assumptions'); assumptions.replaceChildren();
  (quote.assumptions || []).forEach(assumption => assumptions.append(make('li', assumption)));
  if (state.result.input.mode === 'general' && state.result.input.workloadType === 'static') assumptions.append(make('li', 'This catalog compares VM-hosted static files. Serverless object-storage/CDN architectures are not modeled as equivalent offers.'));
  if (!assumptions.childElementCount) assumptions.append(make('li', 'Select an eligible offer or adjust the requirements to inspect architecture and billing assumptions.'));
  const evidence = $('pricing-evidence'); evidence.replaceChildren();
  const sourceParagraph = make('p'), link = sourceLink(quote.sourceUrl, 'Open provider pricing / calculator ↗');
  if (link) sourceParagraph.append(link); else sourceParagraph.textContent = 'No source URL recorded.';
  evidence.append(sourceParagraph);
  evidence.append(make('p', 'Price checked: ' + date(quote.checkedAt) + (quote.stale ? ' · More than 30 days old; verify before purchase.' : '') + ' Pricing snapshot: ' + state.result.snapshotId + '.'));
  evidence.append(make('p', 'Published: ' + date(state.result.publishedAt) + ' · Capacity: ' + (quote.capacity === 'unknown' ? 'not verified' : quote.capacity) + '.'));
  if (quote.nativeTotal !== null && quote.nativeTotal !== undefined && quote.nativeCurrency !== quote.currency) evidence.append(make('p', 'Native estimate: ' + money(quote.nativeTotal, quote.nativeCurrency) + '. Display currency: ' + quote.currency + '.'));
  const fx = state.catalog.fx;
  if (state.result.input.fxRate) evidence.append(make('p', 'Manual display conversion: ' + number(state.result.input.fxRate) + ' INR per USD. User supplied; not a verified local-currency provider tariff.'));
  else if (fx) {
    const rate = fx.rates?.INR;
    const fxParagraph = make('p', 'Reference currency snapshot: ' + date(fx.asOf) + (rate ? ' · ' + number(rate) + ' INR per USD.' : '.'));
    const fxLink = sourceLink(fx.sourceUrl || fx.source, ' Exchange-rate source ↗');
    if (fxLink) fxParagraph.append(fxLink);
    evidence.append(fxParagraph);
  } else if (state.result.input.currency === 'INR') evidence.append(make('p', 'No exchange-rate snapshot is available. Enter a manual INR/USD rate to convert eligible USD prices.'));
}

function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    state.saved = Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && item.input && typeof item.input === 'object').slice(0, 20) : [];
  } catch { state.saved = []; }
}
function persistSaved() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.saved)); return true; }
  catch { $('scenario-status').textContent = 'Browser storage is unavailable or full. Export JSON to keep this comparison.'; return false; }
}
function renderSaved() {
  const list = $('saved-scenarios'); list.replaceChildren();
  $('save-scenario').textContent = state.activeScenarioId ? 'Update scenario' : 'Save scenario';
  $('save-as-scenario').hidden = !state.activeScenarioId;
  $('toggle-scenarios').textContent = $('scenario-body').hidden ? 'Show scenarios' + (state.saved.length ? ' (' + state.saved.length + ')' : '') : 'Hide scenarios';
  $('toggle-scenarios').setAttribute('aria-expanded', String(!$('scenario-body').hidden));
  if (!state.saved.length) list.append(make('p', 'No scenarios saved yet. Name this comparison and save it here.', 'empty-scenarios'));
  for (const scenario of state.saved) {
    const row = make('div', null, 'saved-scenario');
    const description = make('span');
    description.append(make('strong', scenario.name), make('small', (scenario.input.mode === 'gpu' ? 'AI / GPU' : 'General cloud') + ' · ' + ({ india: 'India only', asia: 'India + nearby Asia', world: 'Worldwide' }[scenario.input.geography] || 'Location unrecorded') + ' · saved ' + date(scenario.savedAt)));
    row.append(description);
    const actions = make('div'), load = make('button', 'Load'), remove = make('button', 'Delete');
    load.type = remove.type = 'button';
    load.setAttribute('aria-label', 'Load scenario ' + scenario.name); remove.setAttribute('aria-label', 'Delete scenario ' + scenario.name);
    load.addEventListener('click', () => {
      form.reset(); applyValues(scenario.input); $('preset').value = 'custom'; $('scenario-name').value = scenario.name;
      state.activeMode = scenario.input.mode;
      state.modeDrafts = { [state.activeMode]: fieldValues(state.activeMode) };
      state.modePreset[state.activeMode] = 'custom';
      state.selectedId = null; state.activeScenarioId = scenario.id; state.detailInline = false;
      if (runComparison({ focusErrors: true })) {
        $('scenario-status').textContent = 'Loaded “' + scenario.name + '”. Recalculated with pricing snapshot ' + state.result.snapshotId + (scenario.snapshotId && scenario.snapshotId !== state.result.snapshotId ? ' (originally saved with ' + scenario.snapshotId + ')' : '') + '.';
        $('scenario-body').hidden = false; renderSaved();
      }
    });
    remove.addEventListener('click', () => {
      const previous = [...state.saved], index = state.saved.findIndex(item => item.id === scenario.id);
      state.saved = state.saved.filter(item => item.id !== scenario.id);
      if (persistSaved()) {
        state.deletedScenario = { item: scenario, index };
        $('undo-delete').hidden = false;
        if (state.activeScenarioId === scenario.id) state.activeScenarioId = null;
        renderSaved(); $('scenario-status').textContent = 'Deleted “' + scenario.name + '”. You can undo this deletion.';
      }
      else state.saved = previous;
    });
    actions.append(load, remove); row.append(actions); list.append(row);
  }
}
function saveScenario(asNew = false) {
  if (!state.result || state.dirty) return;
  const name = $('scenario-name').value.trim() || (state.result.input.mode === 'gpu' ? 'GPU ' + state.result.input.gpuTask : 'Cloud ' + state.result.input.workloadType) + ' · ' + date(new Date());
  const existing = !asNew && state.saved.find(item => item.id === state.activeScenarioId);
  if (!existing && state.saved.length >= 20) { $('scenario-status').textContent = 'You have 20 saved scenarios. Delete one before saving another, or export this comparison.'; return; }
  const item = { id: globalThis.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(36).slice(2), name, input: state.result.input, snapshotId: state.result.snapshotId, savedAt: new Date().toISOString() };
  const previous = [...state.saved];
  if (existing) { item.id = existing.id; state.saved = state.saved.map(saved => saved.id === existing.id ? item : saved); }
  else state.saved.unshift(item);
  if (persistSaved()) {
    state.activeScenarioId = item.id; state.deletedScenario = null; $('undo-delete').hidden = true;
    renderSaved(); $('scenario-status').textContent = (existing ? 'Updated' : 'Saved') + ' “' + name + '” in this browser.'; $('scenario-name').value = name;
  } else state.saved = previous;
}
function exportObject() {
  return { app: 'Viviz Cloud Compare', exportedAt: new Date().toISOString(), snapshotId: state.result.snapshotId, publishedAt: state.result.publishedAt, input: state.result.input, warnings: state.result.warnings, quotes: state.result.quotes };
}
function download(content, type, extension) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = make('a'); link.href = url; link.download = 'cloud-comparison-' + state.result.snapshotId.replace(/[^a-z0-9-]/gi, '-') + '.' + extension;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('scenario-status').textContent = 'Exported the last calculated comparison' + (state.dirty ? '. Inputs have changed; compare again to include your edits.' : '.');
}
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  // Spreadsheet applications can execute cells beginning with formula characters.
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function exportCsv() {
  const fields = ['snapshot_id', 'published_at', 'mode', 'provider', 'status', 'offer', 'region', 'currency', 'estimated_total', 'known_subtotal', 'annualized_total', 'capacity', 'price_checked_at', 'pricing_source', 'missing_requirements'];
  const rows = state.result.quotes.map(quote => [state.result.snapshotId, state.result.publishedAt, state.result.input.mode, quote.providerName, quote.status, quote.offerName, quote.region?.name, quote.currency, quote.total, quote.subtotal, quote.annualCost, quote.capacity, quote.checkedAt, quote.sourceUrl, quote.reasons.join(' ')]);
  download('\uFEFF' + [fields, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8', 'csv');
}
function expandForPrint() {
  if (state.printState) return;
  state.printInline = state.detailInline; state.detailInline = false; placeDetail();
  state.printCoverageOpen = $('coverage-details').open;
  $('coverage-details').open = true;
  state.printState = Array.from(document.querySelectorAll('#quote-detail details'), detail => ({ detail, open: detail.open }));
  state.printState.forEach(({ detail }) => { detail.open = true; });
}
function restoreAfterPrint() {
  state.printState?.forEach(({ detail, open }) => { detail.open = open; }); state.printState = null;
  $('coverage-details').open = state.printCoverageOpen; state.printCoverageOpen = false;
  state.detailInline = state.printInline; state.printInline = false; placeDetail();
}

async function loadCatalog() {
  $('compare-button').disabled = true; $('retry').hidden = true;
  $('load-state').hidden = false; $('result-content').hidden = true;
  $('catalog-status').textContent = 'Loading prices';
  $('load-heading').textContent = 'Loading the pricing snapshot';
  $('load-message').textContent = 'Preparing regional configurations and their source prices.';
  try {
    const response = await fetch('./data/catalog.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Pricing snapshot HTTP ' + response.status);
    const catalog = await response.json();
    if (!catalog || !Array.isArray(catalog.providers) || !catalog.providers.length || !Array.isArray(catalog.offers) || !catalog.offers.length || typeof catalog.id !== 'string') throw new Error('Pricing snapshot is empty or malformed.');
    const validation = validateCatalog(catalog);
    if (!validation.valid) throw new Error('Pricing snapshot failed validation: ' + validation.errors.join(' '));
    state.catalog = catalog;
    state.catalogWarnings = validation.warnings;
    const freshness = catalogFreshness(catalog);
    $('catalog-status').textContent = (freshness.status === 'stale' ? 'Older prices · ' : 'Prices checked · ') + date(freshness.checkedAt);
    $('compare-button').disabled = false;
    if (!runComparison({ announce: false })) {
      $('load-state').hidden = true;
      $('form-status').textContent = 'Pricing is ready. Correct the highlighted fields, then compare providers.';
    }
  } catch (error) {
    state.catalog = null;
    $('catalog-status').textContent = 'Prices unavailable';
    $('load-heading').textContent = 'The pricing snapshot could not be loaded';
    $('load-message').textContent = 'Check your connection and retry. If opening this app as a local file, serve it through a web server so the catalog can load.';
    $('retry').hidden = false;
    console.error('Pricing snapshot failed', error);
  }
}

form.addEventListener('submit', event => { event.preventDefault(); runComparison({ focusErrors: true, focusResults: true }); });
form.addEventListener('input', event => { if (event.target.id !== 'preset') markDirty(); });
form.addEventListener('change', event => {
  const control = event.target;
  if (control.id === 'preset') { applyPreset(control.value); return; }
  if (control.name === 'mode') {
    state.modeDrafts[state.activeMode] = fieldValues(state.activeMode);
    if (state.modeDrafts[control.value]) {
      applyValues({ ...state.modeDrafts[control.value], mode: control.value });
      state.activeMode = control.value;
      $('preset').value = state.modePreset[control.value] || 'custom';
      showErrors({}, false); markDirty();
    } else applyPreset(control.value === 'gpu' ? 'inference' : 'webapp');
  } else {
    syncFields(); markDirty();
    if (modeFields[mode()].includes(control.name)) { $('preset').value = 'custom'; state.modePreset[mode()] = 'custom'; }
  }
});
$('sort').addEventListener('change', () => { if (state.result) renderCards(); });
$('retry').addEventListener('click', loadCatalog);
$('update-estimate').addEventListener('click', () => runComparison({ focusErrors: true, focusResults: true }));
$('revert-inputs').addEventListener('click', () => {
  if (!state.result) return;
  form.reset(); applyValues(state.result.input); state.activeMode = state.result.input.mode;
  state.modeDrafts = { [state.activeMode]: fieldValues(state.activeMode) };
  $('preset').value = 'custom'; state.modePreset[state.activeMode] = 'custom';
  showErrors({}, false); setDirty(false); updatePlannerSummaries();
  $('result-live').textContent = 'Inputs reverted to the last calculated comparison.';
});
$('toggle-scenarios').addEventListener('click', () => { $('scenario-body').hidden = !$('scenario-body').hidden; renderSaved(); });
$('save-scenario').addEventListener('click', () => saveScenario());
$('save-as-scenario').addEventListener('click', () => saveScenario(true));
$('undo-delete').addEventListener('click', () => {
  if (!state.deletedScenario) return;
  const { item, index } = state.deletedScenario;
  state.saved.splice(index, 0, item);
  if (persistSaved()) { state.deletedScenario = null; $('undo-delete').hidden = true; renderSaved(); $('scenario-status').textContent = 'Restored “' + item.name + '”.'; }
  else state.saved = state.saved.filter(saved => saved.id !== item.id);
});
$('export-json').addEventListener('click', () => { if (state.result) download(JSON.stringify(exportObject(), null, 2), 'application/json', 'json'); });
$('export-csv').addEventListener('click', () => { if (state.result) exportCsv(); });
$('print').addEventListener('click', () => { expandForPrint(); window.print(); });
window.addEventListener('beforeprint', expandForPrint);
window.addEventListener('afterprint', restoreAfterPrint);
readSaved(); state.modeDrafts.general = fieldValues('general'); syncFields(); loadCatalog();
