import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateCatalog } from '../lib/catalog.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CURRENT = resolve(ROOT, 'data/catalog.json');
const SOURCE_MAP = {
  azure: {
    url: 'https://prices.azure.com/api/retail/prices',
    docs: 'https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices',
    next: body => body.NextPageLink,
    configure: url => {
      url.searchParams.set('$filter', "serviceName eq 'Virtual Machines' and armRegionName eq 'centralindia' and priceType eq 'Consumption'");
      url.searchParams.set('currencyCode', "'USD'");
    },
  },
  digitalocean: { url: 'https://api.digitalocean.com/v2/sizes?per_page=200', env: 'DIGITALOCEAN_TOKEN', docs: 'https://docs.digitalocean.com/reference/api/reference/sizes/', next: body => body.links?.pages?.next },
  hetzner: { url: 'https://api.hetzner.cloud/v1/pricing', env: 'HCLOUD_TOKEN', docs: 'https://docs.hetzner.cloud/reference/cloud#pricing' },
  runpod: { url: 'https://api.runpod.io/v2/catalog/gpus', env: 'RUNPOD_API_KEY', docs: 'https://docs.runpod.io/api-reference-v2/catalog/list-gpu-types' },
  lambda: { url: 'https://cloud.lambda.ai/api/v1/instance-types', env: 'LAMBDA_API_KEY', docs: 'https://docs.lambda.ai/api/cloud' },
};

function argsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (['--check', '--publish', '--help'].includes(arg)) result[arg.slice(2)] = true;
    else if (['--input', '--fetch', '--output'].includes(arg)) {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${arg} requires a value.`);
      result[arg.slice(2)] = argv[++index];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return result;
}

export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Publication validates first. A failed import never overwrites the current snapshot. */
export async function publishCatalog(catalog, { currentPath = CURRENT, snapshotDirectory = resolve(ROOT, 'data/snapshots'), now = new Date() } = {}) {
  const validation = validateCatalog(catalog, { now, allowUnverified: false });
  if (!validation.valid) throw new Error(`Catalog rejected:\n${validation.errors.join('\n')}`);
  const snapshotPath = resolve(snapshotDirectory, `${catalog.id}.json`);
  await mkdir(snapshotDirectory, { recursive: true });
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  // Historical versions are immutable. An identical retry is safe.
  try { await writeFile(snapshotPath, serialized, { flag: 'wx', mode: 0o644 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await readFile(snapshotPath, 'utf8') !== serialized) throw new Error(`Snapshot ${catalog.id} already exists with different data. Choose a new id.`);
  }
  await atomicJson(currentPath, catalog);
  return { snapshotPath, currentPath, warnings: validation.warnings };
}

async function fetchOfficial(provider, output) {
  const source = SOURCE_MAP[provider];
  if (!source) throw new Error(`No verified fetch adapter for ${provider}. Supported: ${Object.keys(SOURCE_MAP).join(', ')}. Use --input for reviewed normalized catalogs from other official sources.`);
  const secret = source.env ? process.env[source.env] : null;
  if (source.env && !secret) throw new Error(`Set ${source.env} in the importer environment. Never put credentials in application data.`);
  const headers = { Accept: 'application/json' };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  const first = new URL(source.url);
  source.configure?.(first);
  let next = first.href;
  const pages = [];
  const seen = new Set();
  while (next) {
    const url = new URL(next);
    if (url.origin !== first.origin || url.protocol !== 'https:' || url.username || url.password) throw new Error('Refused pagination outside the official API origin.');
    if (seen.has(url.href) || pages.length >= 100) throw new Error('Pagination did not finish safely; current catalog is unchanged.');
    seen.add(url.href);
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Official ${provider} API returned HTTP ${response.status}; current catalog is unchanged.`);
    const bodyText = await response.text();
    if (bodyText.length > 20_000_000) throw new Error('API response exceeds staging size limit.');
    const body = JSON.parse(bodyText);
    pages.push(body);
    next = source.next?.(body) ?? null;
  }
  const staged = { provider, fetchedAt: new Date().toISOString(), sourceUrl: first.href, documentationUrl: source.docs, normalizationRequired: true, pages };
  const path = resolve(output ?? resolve(ROOT, 'data/staging', `${provider}-${new Date().toISOString().replaceAll(':', '-')}.json`));
  await atomicJson(path, staged);
  process.stdout.write(`Staged ${pages.length} official API page(s) at ${path}. Review region/SKU/billing units and normalize before publishing. Current catalog unchanged.\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = argsOf(argv);
  if (args.help || !argv.length) {
    process.stdout.write('Usage:\n  npm run prices:check\n  node scripts/sync-prices.mjs --input reviewed.json [--publish]\n  node scripts/sync-prices.mjs --fetch azure|digitalocean|hetzner|runpod|lambda [--output staged.json]\n\n--fetch only stages read-only official API responses. --publish requires a reviewed, normalized catalog and preserves versioned snapshots.\n');
    return;
  }
  if (args.fetch) {
    if (args.publish || args.input || args.check) throw new Error('--fetch cannot be combined with --publish, --input or --check. Fetching never publishes.');
    await fetchOfficial(args.fetch, args.output);
    return;
  }
  if (args.output) throw new Error('--output is only valid with --fetch.');
  if (args.publish && !args.input) throw new Error('--publish requires --input reviewed.json.');
  const path = args.input ? resolve(args.input) : CURRENT;
  const catalog = JSON.parse(await readFile(path, 'utf8'));
  const validation = validateCatalog(catalog, { allowUnverified: false });
  if (!validation.valid) throw new Error(`Catalog rejected:\n${validation.errors.join('\n')}`);
  if (args.publish) {
    const result = await publishCatalog(catalog);
    process.stdout.write(`Published ${catalog.id}; immutable snapshot: ${result.snapshotPath}\n`);
  } else process.stdout.write(`Valid catalog ${catalog.id}: ${catalog.providers.length} providers, ${catalog.offers.length} offers.\n`);
  for (const warning of validation.warnings) process.stdout.write(`Warning: ${warning}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
