'use strict';
// Fictional baseline rates in USD, intentionally not live or verified AWS prices.
const RATES = { ec2: [0.012, 0.024, 0.048, 0.096], disk: 0.10, s3: 0.025, requests: 0.005, alb: 0.025, lcu: 0.008, rds: [0.025, 0.05, 0.10], dbDisk: 0.12, dynamoRead: 0.25, dynamoWrite: 1.25, dynamoStorage: 0.25, logs: 0.50, logStorage: 0.03, alarm: 0.10, cdn: 0.085, cdnRequests: 0.01, transfer: 0.11, ipv4: 0.005 };
const REGIONS = { mumbai: { name: 'Asia Pacific (Mumbai)', factor: 1.10 }, virginia: { name: 'US East (N. Virginia)', factor: 1 }, singapore: { name: 'Asia Pacific (Singapore)', factor: 1.15 }, frankfurt: { name: 'Europe (Frankfurt)', factor: 1.12 } };
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
const form = document.getElementById('usage-form');

// Validate both individual values and the relationships between audience inputs.
function readInputs() {
  const data = Object.fromEntries(new FormData(form));
  let firstError = null;
  const errors = {};
  for (const key of ['registered', 'active', 'concurrent', 'storage', 'transfer']) {
    const isUsers = ['registered', 'active', 'concurrent'].includes(key);
    const value = Number(data[key]);
    if (data[key].trim() === '' || !Number.isFinite(value) || value < (isUsers ? 1 : 0) || value > 1e9 || (isUsers && !Number.isInteger(value))) {
      errors[key] = isUsers ? 'Enter a whole number from 1 to 1,000,000,000.' : 'Enter a number from 0 to 1,000,000,000.';
    }
    data[key] = value;
  }
  if (!errors.active && !errors.registered && data.active > data.registered) errors.active = 'Active users cannot exceed registered users.';
  if (!errors.concurrent && !errors.active && data.concurrent > data.active) errors.concurrent = 'Concurrent users cannot exceed monthly active users.';
  for (const key of ['registered', 'active', 'concurrent', 'storage', 'transfer']) {
    const input = document.getElementById(key);
    document.getElementById(`${key}-error`).textContent = errors[key] || '';
    input.setAttribute('aria-invalid', String(Boolean(errors[key])));
    input.setAttribute('aria-describedby', `${key}-error`);
    if (errors[key] && !firstError) firstError = input;
  }
  document.getElementById('form-status').textContent = firstError ? 'Please correct the highlighted fields before calculating.' : '';
  if (firstError) { firstError.focus(); return null; }
  return data;
}

// Pure recommendation engine: selective services, explicit workload heuristics, and no requests to a server.
function recommend(d) {
  const region = REGIONS[d.region], factor = region.factor, hours = 730;
  const ha = d.availability === 'high';
  const staticSite = d.type === 'website' && d.database === 'none';
  const actions = d.type === 'api' ? 300 : d.type === 'ecommerce' ? 150 : 100;
  const requests = d.active * actions;
  const cdn = d.type !== 'api' && (staticSite || d.transfer >= 100 || d.active >= 5000);
  const rows = [];
  // Round line items first so the displayed table always adds up to the total.
  const add = (name, why, cost, assumptions) => rows.push({ name, why, cost: Math.round(cost * factor * 100) / 100, assumptions: `${assumptions} Regional planning multiplier: ${factor}×.` });
  let instances = 0;
  if (!staticSite) {
    const load = d.concurrent * (d.type === 'ecommerce' ? 1.5 : d.type === 'api' ? 0.75 : 1);
    const tier = load <= 50 ? 0 : load <= 200 ? 1 : load <= 500 ? 2 : 3;
    instances = Math.max(ha ? 2 : 1, Math.ceil(load / 1000));
    const names = ['t3.small', 't3.medium', 't3.large', 't3.xlarge'];
    add('Amazon EC2', 'Runs application code and handles dynamic requests.', instances * (hours * RATES.ec2[tier] + 30 * RATES.disk), `${instances} × ${names[tier]} Linux planning instance(s); ${hours} hours each × $${RATES.ec2[tier]}/hour, plus 30 GB EBS each × $${RATES.disk}/GB-month. Sizing score = concurrent users × application weight (${d.type === 'ecommerce' ? 1.5 : d.type === 'api' ? 0.75 : 1}); tiers at 50/200/500, scale out above 1,000. CPU credits are excluded; benchmark before choosing instances.`);
    if (ha || instances > 1) {
      const lcus = Math.max(1, Math.ceil(d.concurrent / 1000), Math.ceil((cdn ? d.transfer * 0.3 : d.transfer) / hours));
      add('Elastic Load Balancing', 'An Application Load Balancer distributes traffic across application instances.', hours * (RATES.alb + lcus * RATES.lcu), `${hours} hours × $${RATES.alb}/hour + ${lcus} assumed average LCU(s) × ${hours} × $${RATES.lcu}/LCU-hour. LCU heuristic uses concurrency / 1,000 and origin GB / 730; actual connections, bytes, and rule evaluations can change this.`);
    }
    const ips = (ha || instances > 1) ? 2 : 1;
    add('Public IPv4 allowance', 'Budgets public addresses for the internet-facing entry point.', ips * hours * RATES.ipv4, `${ips} assumed public IPv4 address(es) × ${hours} hours × $${RATES.ipv4}/address-hour. Assumes direct EC2 access for one instance or a two-zone public ALB; additional addresses are excluded.`);
  }
  if (d.storage > 0 || staticSite) {
    const storage = staticSite ? Math.max(1, d.storage) : d.storage;
    const objectRequests = Math.ceil(requests * (staticSite ? 1 : 0.2));
    add('Amazon S3', staticSite ? 'Hosts the assumed static website assets behind CloudFront.' : 'Stores uploaded files, images, and application assets.', storage * RATES.s3 + objectRequests / 1000 * RATES.requests, `${number(storage)} GB × $${RATES.s3}/GB-month + ${number(objectRequests)} origin object requests / 1,000 × $${RATES.requests}. ${staticSite && d.storage === 0 ? 'A 1 GB website asset minimum is assumed. ' : ''}All modeled requests use one blended rate; actual GET/PUT rates differ.`);
  }
  if (d.database === 'relational') {
    const tier = d.active <= 10000 ? 0 : d.active <= 100000 ? 1 : 2;
    const dbStorage = Math.max(20, Math.ceil(d.registered * 0.001));
    const copies = ha ? 2 : 1;
    add('Amazon RDS', 'Managed PostgreSQL stores structured application data and relationships.', copies * (hours * RATES.rds[tier] + dbStorage * RATES.dbDisk), `${copies} database instance/storage copies (${ha ? 'primary and Multi-AZ standby' : 'single AZ'}); db.t3.${['small', 'medium', 'large'][tier]} planning tier × ${hours} × $${RATES.rds[tier]}/hour; ${number(dbStorage)} GB per copy × $${RATES.dbDisk}/GB-month. Storage = max(20 GB, registered users × 0.001 GB). Multi-AZ modeled by doubling compute and storage; actual pricing varies.`);
  } else if (d.database === 'nosql') {
    const storage = Math.max(1, d.registered * 0.0005), reads = requests * 4, writes = requests;
    add('Amazon DynamoDB', 'Managed key-value/document storage for a NoSQL data model.', storage * RATES.dynamoStorage + reads / 1e6 * RATES.dynamoRead + writes / 1e6 * RATES.dynamoWrite, `${number(storage)} GB × $${RATES.dynamoStorage}/GB-month; ${number(reads)} read units / 1 million × $${RATES.dynamoRead}; ${number(writes)} write units / 1 million × $${RATES.dynamoWrite}. Assumes 4 eventual-consistency read units and 1 write unit per action; small items, no indexes or global tables. Storage = max(1 GB, users × 0.0005 GB).`);
  }
  if (!staticSite || ha) {
    const logs = Math.max(1, requests * 0.00001), alarms = ha ? 10 : 5;
    add('Amazon CloudWatch', 'Collects operational logs and alarms for the running workload.', logs * (RATES.logs + RATES.logStorage) + alarms * RATES.alarm, `${number(logs)} GB monthly logs × ($${RATES.logs} ingestion + $${RATES.logStorage} retained storage) + ${alarms} alarms × $${RATES.alarm}/month. Assumes 10 KB logs per action, at least 1 GB, and one month retention. Custom metrics excluded.`);
  }
  if (cdn) {
    add('Amazon CloudFront', 'Delivers cacheable content at the edge; a private S3 origin is assumed for a static website.', d.transfer * RATES.cdn + requests / 10000 * RATES.cdnRequests, `${number(d.transfer)} GB viewer transfer × $${RATES.cdn}/GB + ${number(requests)} HTTPS requests / 10,000 × $${RATES.cdnRequests}. Assumes all viewer transfer passes through CloudFront and 70% cache hit ratio. No duplicate internet egress charge is added for the AWS origin; dynamic traffic still reaches compute.`);
  } else if (d.transfer > 0) {
    add('Internet data transfer', 'Accounts for data sent directly from the application to customers.', d.transfer * RATES.transfer, `${number(d.transfer)} GB × $${RATES.transfer}/GB. Free allowances are deliberately excluded. Transfer is charged here only when CloudFront is not modeled.`);
  }
  return { rows, total: rows.reduce((sum, row) => sum + row.cost, 0), staticSite, cdn, instances, requests, region, ha };
}

// Use DOM text nodes for all report content; no user values are interpreted as HTML.
function render(d, r) {
  document.getElementById('empty-state').hidden = true;
  document.getElementById('result-content').hidden = false;
  document.getElementById('total').textContent = `${money(r.total)} / mo`;
  document.getElementById('table-total').textContent = money(r.total);
  document.getElementById('service-count').textContent = `${r.rows.length} line items`;
  document.getElementById('result-meta').textContent = `${r.region.name} · ${r.ha ? 'High availability' : 'Standard availability'} · 730 hours / month`;
  const tbody = document.getElementById('service-rows'); tbody.replaceChildren();
  const bar = document.getElementById('cost-bar'); bar.replaceChildren();
  r.rows.forEach((row, i) => {
    const tr = document.createElement('tr'), service = document.createElement('td'), cost = document.createElement('td');
    const title = document.createElement('strong'), why = document.createElement('p'), details = document.createElement('details'), summary = document.createElement('summary'), math = document.createElement('p');
    title.textContent = row.name; why.textContent = row.why; summary.textContent = 'Calculation & assumptions'; math.textContent = row.assumptions;
    details.append(summary, math); service.append(title, why, details); cost.textContent = money(row.cost); tr.append(service, cost); tbody.append(tr);
    const segment = document.createElement('span'); segment.style.flexGrow = row.cost; segment.style.background = ['#fff','#a7c4ff','#80aaff','#b4e5ed','#c8c1fa','#e2d9fa','#6de0cc','#bed5ff'][i % 8]; bar.append(segment);
  });
  const flow = ['Users', ...(r.cdn ? ['CloudFront'] : []), ...(r.staticSite ? ['S3'] : [...(r.ha || r.instances > 1 ? ['Load balancer'] : []), 'EC2']), ...(d.database !== 'none' ? [d.database === 'relational' ? 'RDS' : 'DynamoDB'] : [])];
  const flowNode = document.getElementById('architecture-flow'); flowNode.replaceChildren();
  flow.forEach((name, i) => { if (i) { const arrow = document.createElement('b'); arrow.textContent = '→'; flowNode.append(arrow); } const chip = document.createElement('span'); chip.textContent = name; flowNode.append(chip); });
  document.getElementById('architecture').textContent = r.staticSite ? `A static website serves assets from a private S3 bucket through CloudFront. No application server or database is modeled. ${r.ha ? 'S3 and CloudFront provide managed redundancy; monitor availability with CloudWatch.' : 'This assumes client-side content with no server-side business logic.'}` : `${r.cdn ? 'CloudFront fronts cacheable content. ' : ''}${r.ha || r.instances > 1 ? 'An Application Load Balancer routes requests to ' : 'Requests reach '}${r.instances} EC2 instance(s)${r.ha ? ' spread across at least two Availability Zones' : ''}. ${d.database === 'relational' ? (r.ha ? 'RDS uses a Multi-AZ primary and standby.' : 'RDS runs in one Availability Zone.') : d.database === 'nosql' ? 'DynamoDB provides managed regional data storage.' : 'No persistent database is modeled.'} ${d.storage > 0 ? 'S3 stores files separately from the database. ' : ''}CloudWatch supports operations. ${r.ha ? 'Application statelessness, health checks, failover testing, and deployment design are still required for high availability.' : 'A single-zone deployment can be interrupted; this is a starting architecture.'}`;
  document.getElementById('workload-summary').textContent = `${number(d.registered)} registered · ${number(d.active)} monthly active · ${number(d.concurrent)} concurrent · ${number(d.storage)} GB object storage · ${number(d.transfer)} GB outbound. Assumed ${number(r.requests)} actions/month (${d.type === 'api' ? 300 : d.type === 'ecommerce' ? 150 : 100} per active user). Registered users drive database size; active users drive request and log estimates; concurrency drives compute sizing.`;
  const tips = ['Measure real request rates, CPU, memory, and latency in a load test before sizing production. Set budgets and billing alerts.', ...(r.staticSite ? ['Keep the static architecture while requirements allow; adding server logic changes the cost model.'] : ['Right-size instances after observing utilization; consider Savings Plans only after usage is stable.', 'Schedule nonproduction instances to stop outside working hours; production is modeled as running continuously.']), ...(d.storage > 0 ? ['Use S3 lifecycle policies for older objects and remove unused files after checking retention needs.'] : []), ...(r.cdn ? ['Improve cache hit rates and compress assets to reduce origin load and delivered bytes.'] : ['Compress responses and reduce unnecessary downloads to lower transfer costs.']), ...(d.database !== 'none' ? ['Review database indexes, item sizes, retention, and backups; inefficient queries can change the estimate substantially.'] : []), ...(r.ha ? ['Keep redundancy required by your recovery objectives; reducing availability for cost needs an explicit business decision.'] : [])];
  const list = document.getElementById('savings'); list.replaceChildren(); tips.forEach(tip => { const li = document.createElement('li'); li.textContent = tip; list.append(li); });
  document.getElementById('total').focus();
}
form.addEventListener('submit', event => { event.preventDefault(); const data = readInputs(); if (data) render(data, recommend(data)); });
document.getElementById('recalculate').addEventListener('click', () => { document.getElementById('planner').scrollIntoView({ behavior: 'smooth' }); document.getElementById('registered').focus(); });
document.getElementById('print').addEventListener('click', () => {
  // Expand calculation details for the PDF, then restore the user's expanded/collapsed state.
  document.querySelectorAll('#service-rows details').forEach(detail => { detail.dataset.wasOpen = String(detail.open); detail.open = true; });
  window.print();
});
window.addEventListener('afterprint', () => document.querySelectorAll('#service-rows details').forEach(detail => { detail.open = detail.dataset.wasOpen === 'true'; }));
