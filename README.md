# Viviz Cloud Compare

An India-first cloud and GPU estimation app. Compare configurations against a **versioned, source-linked pricing snapshot**, then inspect the bill, architecture, assumptions and coverage gaps. All estimation runs in the browser; normal operation needs no cloud credentials, backend, database or build step.

## Run and verify

Use Node.js 22 or later. There are no npm dependencies to install.

```sh
npm run dev
# http://127.0.0.1:8080

npm test
npm run prices:check
```

Use `npm.cmd` on Windows PowerShell if execution policy prevents running `npm.ps1`. To choose another local port: `npm run dev -- --port 8090`. Open the app through HTTP; browser ES modules and catalog loading do not work reliably through a `file://` URL.

## What the comparison means

- **General cloud:** guided audience sizing or explicit CPU/RAM/count, runtime, disks, outbound transfer, object storage/requests, backups, database, availability, growth, and optional user-supplied monitoring/operating costs.
- **AI/GPU:** exact GPU model or any compatible model, requested count, per-card VRAM, host CPU/RAM, runtime per job, job count and persistent disk retention. Whole instances and explicit per-GPU-hour products are billed differently. Runtime comes from the user; the app does not invent throughput benchmarks or predict model training time.
- **Region:** India only, India plus nearby Asia, or the catalog's worldwide coverage. A listed nearby region does not imply measured latency or Indian data residency.
- **Currency:** native prices are converted using the catalog's dated currency-per-USD reference rates, or an explicitly supplied INR/USD reference rate. A missing or stale required conversion prevents a complete estimate. Conversion is not a provider's local-currency tariff.
- **Ranking:** the lowest complete estimate meeting the requirements wins. A partial quote shows its known subtotal and missing cost items; it cannot win. Unsupported regions, hardware and availability requirements remain visible.

Providers include AWS, Azure, Google Cloud, DigitalOcean, Hetzner, Runpod, Lambda and E2E Networks. **Coverage varies by provider, service, region and hardware.** Some entries are published global GPU reference rates with unverified regional tariffs; these are partial and cannot win as regional estimates. Refer to `data/catalog.json`, the app's coverage view, each quote's sources and the snapshot's methodology for the exact current inventory. An unsupported or missing offering does not mean the provider never sells it.

The planner keeps separate general-cloud and GPU drafts when switching modes. Choosing a preset explicitly resets that mode's workload fields; location, currency and selected providers remain shared. Results stay marked as previous estimates after an input changes until **Update estimate** is used, and **Revert edits** restores the last calculated inputs. On mobile, the Compare action stays within reach while scrolling the planner and successful comparisons take focus to the results.

The comparison board places complete estimates together with region, machine class, bundled resources and the price difference from the lowest complete option. Quotes needing price verification or outside the current catalog are grouped separately. GPU comparison defaults to a specific A100 PCIe variant; the broader model choices are for exploration and still use the user's supplied runtime. Saved scenarios can be updated, copied or restored after deletion. Loading a saved scenario recalculates it against the current snapshot and shows when its original snapshot differs.

Managed databases require an explicitly matched managed plan, including storage and requested availability. Self-managed databases reserve additional VM resources and disk, and are separate scenarios. High availability needs verified separate zones and verified load-balancer costs; replication/failover gaps prevent a complete estimate. Matching vCPU/RAM is a sizing comparison, not a claim of equal CPU performance.

Compute billing increments, monthly caps/minimums, included disks/transfer, disk size minimums/fixed tiers and graduated egress tiers are modeled when recorded. Standard monthly estimates use 730 hours. GPU disks follow the selected retention period. Inbound, inter-zone and cross-region transfer, taxes, paid support, NAT/WAF, free credits, commitment discounts, and unlisted services are excluded unless explicitly included in a line item. Check the displayed assumptions before treating a total as a budget.

## Pricing provenance and refresh

The browser never calls pricing APIs or holds provider credentials. This release ships reviewed snapshots; it does **not** claim a live full-market feed. Source-check dates determine freshness: over 30 days is flagged, and over 90 days prevents a quote from winning. Republishing an old rate does not refresh its source-check date. GPU capacity is unknown unless separately confirmed with the provider; a listed rate does not reserve capacity.

`lib/catalog.js` validates schema, ids, nonnegative numeric values, billing units, tiers, FX rates and source provenance. Use `null` for unknown rates, never zero. Record verified included/free components as `0`, with source evidence. `data/snapshots/<id>.json` stores immutable catalog versions; `data/catalog.json` is the active snapshot. Estimates retain the snapshot id for reproduction.

To stage official API data for review:

```sh
node scripts/sync-prices.mjs --fetch azure
node scripts/sync-prices.mjs --fetch digitalocean
node scripts/sync-prices.mjs --fetch hetzner
node scripts/sync-prices.mjs --fetch runpod
node scripts/sync-prices.mjs --fetch lambda
```

These adapters issue read-only GET requests and stage raw JSON under ignored `data/staging/`. Azure stages Central India consumption VM meters in USD; it is not a complete Azure catalog or full bill. Paginated Azure and DigitalOcean results are collected with an origin check and bounded page count. No raw fetch automatically updates estimates. Provider APIs, authentication and catalog formats can change; an importer error leaves the active catalog untouched.

| Adapter | Environment variable | Official API documentation |
|---|---|---|
| Azure | None | [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) |
| DigitalOcean | `DIGITALOCEAN_TOKEN` with read access | [Sizes API](https://docs.digitalocean.com/reference/api/reference/sizes/) |
| Hetzner | `HCLOUD_TOKEN` with read access | [Cloud pricing](https://docs.hetzner.cloud/reference/cloud#pricing) |
| Runpod | `RUNPOD_API_KEY` | [GPU catalog](https://docs.runpod.io/api-reference-v2/catalog/list-gpu-types) |
| Lambda | `LAMBDA_API_KEY` | [Instance types API](https://docs.lambda.ai/api/cloud) |

Keep credentials in the importer environment or CI secrets. Never add them to frontend files, a committed `.env` file, a normalized catalog, or a raw staging artifact. The app's normal Docker image excludes importer tooling and staging data. AWS bulk price lists, Google Cloud Billing catalog and other providers currently require a reviewed manual normalization step; no incomplete automatic mapping is advertised as a full integration.

After staging, reconcile the exact region, operating system, SKU, billing unit, included allowances, storage/egress components and effective dates against official pricing documentation. Update a copy of the normalized catalog with a **new version id**, retaining source URLs and actual check dates; do not copy sample documentation rates as verified regional tariffs.

```sh
# Validate a reviewed normalized candidate without changing active data
node scripts/sync-prices.mjs --input reviewed-catalog.json

# Publish it to an immutable historical version and atomically replace active data
node scripts/sync-prices.mjs --input reviewed-catalog.json --publish

# Validate the active catalog
npm run prices:check
```

Validation failures preserve the last valid active file. Reusing an existing version id with changed data is rejected; identical retries are allowed. Snapshot publication is a local file operation: deploy the resulting static assets through your usual deployment process. The daily GitHub workflow validates the catalog and runs tests. Its manual `stage_azure` option downloads raw Azure pricing as a review artifact; it never commits or publishes unreviewed prices.

## Project structure

| Path | Responsibility |
|---|---|
| `index.html`, `styles.css`, `script.js` | Accessible workload forms, comparison, detailed reports and browser interactions |
| `lib/engine.js` | Pure validation, sizing, eligibility, itemized pricing, conversion and ranking |
| `lib/catalog.js` | Catalog validation and source freshness |
| `data/catalog.json`, `data/snapshots/` | Active and reproducible historical catalogs |
| `scripts/sync-prices.mjs` | Read-only official API staging and validated snapshot publication |
| `scripts/serve.mjs` | Local static HTTP server with ES module MIME types |
| `tests/` | Node built-in tests using explicitly fictional fixtures; no live pricing dependency |

Tests exercise missing-rate ranking, region restrictions, bundled allowances, billing caps and increments, disk and egress tiers, database/HA parity, GPU memory/count/units, currencies, stale data, reproducibility and safe publication. Reconcile changed provider prices with the official calculator/source before deploying a refreshed snapshot.

## Deploy with Coolify

Use the `main` branch, Dockerfile build pack, base directory `/`, Dockerfile `/Dockerfile`, and container port `8080`. Retain the existing configured domain (for example `https://aws.viviz.in`) and point DNS to the application server, or choose a new comparison-specific domain in your deployment settings.

The Docker image serves the app, ES modules and reviewed pricing data through unprivileged Nginx on port 8080 and includes an HTTP health check. No build commands, runtime API keys or environment variables are required. Deployment is not performed by the pricing scripts.
