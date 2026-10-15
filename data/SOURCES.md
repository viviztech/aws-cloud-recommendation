# Pricing snapshot provenance

Snapshot `india-asia-2026-10-15-v2` was reviewed on **15 October 2026**. It contains a deliberately limited shortlist, not every product sold by each provider. Prices exclude taxes, credits, negotiated discounts, commitments, software licensing, operating labor and services absent from the quote. `capacity: unknown` is intentional: a published price does not establish deployable capacity or approved GPU quota.

`verified: true` means a published price and hardware specification were observed. For frontier GPU references, `regionalPricingVerified: false` explicitly prevents treating a separately documented India region as proof that this exact configuration or rate can be purchased there. These are incomplete estimates.

## Units and scope

UI storage/transfer inputs use decimal GB. Where a provider explicitly publishes GiB, the catalog declares `diskUnit`, `transferUnit` or `egressUnit` as `GiB`; the engine must convert bytes before applying those prices or allowances. Memory requirements use conservative nominal advertised GB/GiB figures, not a CPU-performance benchmark. AWS and Hetzner public TB allowances are conservatively recorded as 1,000 nominal GB/TB; this can understate an allowance and is disclosed in each offer. Hetzner offers use only the documented AP minimum allowance of 0.5 TB, because exact per-plan allowances were not imported. Usage beyond that minimum must remain incomplete rather than assume an overage price.

An included VM boot disk is separate from the requested extra persistent capacity. GPU local/root scratch disks are not counted toward storage retained after instance termination. Unknown addons are `null`, never an invented zero. A zero IPv4/egress rate appears only where an official source explicitly includes it. `zoneCount: 1` is a conservative capability floor; it does not assert that a hyperscaler region has only one availability zone or that a plan supports redundant deployment.

## AWS

- [Mumbai regional Lightsail price file](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonLightsail/current/ap-south-1/index.json) and [Singapore file](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonLightsail/current/ap-southeast-1/index.json), publication `2026-09-15T15:19:51Z`, selected on-demand terms effective `2026-09-01`.
- Selection: `productFamily = Lightsail Instance`, `operatingSystem = Linux`, operation exactly `Bundle:2GB`, `Bundle:4GB`, `Bundle:8GB`, `Bundle:16GB`. This excludes IPv6-only, Windows and compute/memory-optimized bundles. Prices are read from `terms.OnDemand[*].priceDimensions[*].pricePerUnit.USD`, unit `Hrs`.

| RAM | Mumbai SKU | Singapore SKU | USD/hour | Published monthly cap |
|---|---|---|---:|---:|
| 2 GB | EYPUSJKXX85YMZPE | NBSGR8DQN2PW4T36 | 0.01612 | 12 |
| 4 GB | M5DQWH9VSHR9E2C7 | EZ9QFPG6SW7ASBPB | 0.03225 | 24 |
| 8 GB | MQZFVMDGSKN7KJ4X | MY73GG9BDFTPCK2E | 0.05913 | 44 |
| 16 GB | MM5G9A99PM22KNG3 | GPJC77FKCUFCA44V | 0.11290 | 84 |

The regional files supply CPU, disk and transfer quota; Mumbai quotas are half Singapore's. Mumbai transfer-overage SKU `SNKMSVTWUHJFVVKU` is **$0.13/GB**, Singapore `SJ79HUBUN4CZQWJZ` is **$0.12/GB**. These are instance-transfer meters, distinct from object-storage transfer. [Published pricing](https://aws.amazon.com/lightsail/pricing/) supplies monthly caps, additional disk $0.10/GB-month and snapshot storage $0.05/GB-month. [Billing documentation](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-frequently-asked-questions-faq-billing-and-account-management.html) establishes capped hourly billing, ongoing charges until deletion and no additional charge for attached static IPv4. Inbound traffic also consumes the instance allowance; estimates assume negligible ingress.

## Microsoft Azure

[Retail Prices API](https://prices.azure.com/api/retail/prices) was queried directly without account credentials. Each offer stores its exact encoded query. VM filters: service `Virtual Machines`, region `centralindia`, `priceType = Consumption`, exact `armSkuName`. Select the primary Linux consumption meter with no Windows, Cloud Services, Spot or Low Priority suffix.

| Exact ARM SKU | Selected product/meter | USD/hour | Effective date |
|---|---|---:|---|
| Standard_D2as_v5 | Virtual Machines Dasv5 Series / D2as v5 | 0.0556 | 2021-11-01 |
| Standard_D4as_v5 | Virtual Machines Dasv5 Series / D4as v5 | 0.111 | 2021-11-01 |
| Standard_NC24ads_A100_v4 | NCads A100 v4 Series Linux / NC24ads_A100_v4 | 5.142 | 2023-05-01 |

Specifications: [Dasv5](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dasv5-series) and [NC A100 v4](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nca100v4-series). The GPU has one 80 GB A100 PCIe; local temporary/NVMe disk is excluded from persistent capacity.

Disk query selects `productName = Premium SSD Managed Disks`, region `centralindia`, Consumption, exact `P1/P2/P3/P4/P6/P10/P15/P20/P30 LRS Disk` meters, excluding mount and burst meters. [Documented capacities](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types#premium-ssd-size) are 4/8/16/32/64/128/256/512/1024 GiB; observed monthly USD prices are 0.84/1.68/3.36/5.2795/10.207/19.71/38.012142/73.22/135.17. Capacity rounds up to a tier; storage beyond the last imported tier is incomplete. Paid on-demand bursting is excluded.

The API's `IP Addresses` product, Standard SKU, meter `Standard IPv4 Static Public IP` returns $0.005/hour. [Bandwidth pricing](https://azure.microsoft.com/en-us/pricing/details/bandwidth/) specifies 100 GB/account-month free, then $0.12/GB from Asia via Microsoft Premium Global Network for the next 10 TB. Higher-volume discount tiers are not imported. `egressMaxGb: 10000` limits the modeled paid usage after the free allowance; exceeding that bound produces an incomplete estimate. Free allowance is assumed unused by existing resources.

## Google Cloud

[General-purpose pricing](https://cloud.google.com/products/compute/pricing/general-purpose) embeds separate regional tables. The shortlist uses the **Mumbai (asia-south1)** and **Singapore (asia-southeast1)** E2 standard default on-demand USD columns, not the initially displayed Iowa table and not commitment columns. E2 standard-2 has 2 vCPUs/8 GiB; standard-4 and standard-8 double/quadruple resources and price.

| Region | E2 standard-2 USD/hour | Balanced Persistent Disk USD/GiB-month |
|---|---:|---:|
| Mumbai | 0.08048436 | 0.12 |
| Singapore | 0.08266614 | 0.11 |

[Disk pricing](https://cloud.google.com/compute/disks-image-pricing) values come from each region's exact `Balanced provisioned space` cell, not similarly named regional or Hyperdisk products. [VPC pricing](https://cloud.google.com/vpc/network-pricing) regional **Standard Tier** tables give $0.11/GiB for the first paid tier in both regions, after 200 GiB free/account-month across all regions. The initially displayed Iowa $0.085 rate must not be used for India. In-use standard-VM external IPv4 is $0.005/hour. The comparison explicitly requires Standard Network Tier; Premium routing is a different product. Existing account usage may consume the allowance; higher-volume discounts are not imported. The first paid interval ends at total usage 10,240 GiB: `egressMaxGb: 10040` limits paid usage after subtracting the 200 GiB free allowance. Exceeding it produces an incomplete estimate.

## DigitalOcean

[Droplet prices](https://www.digitalocean.com/pricing/droplets): Regular Basic bundled plans `s-1vcpu-2gb`, `s-2vcpu-2gb`, `s-2vcpu-4gb`, `s-4vcpu-8gb`, `s-8vcpu-16gb`. The published rows supply RAM, CPU, included GiB storage/transfer, hourly prices and monthly caps. The same page documents Bangalore and Singapore datacenters and included bundled IPv4. Live per-plan inventory is not checked.

[Billing documentation](https://docs.digitalocean.com/products/droplets/details/pricing/) establishes per-second billing from January 1, 2026, a 60-second/$0.01 minimum and caps. [Bandwidth documentation](https://docs.digitalocean.com/platform/billing/bandwidth/) establishes transfer accrual over 672 hours, account pooling and $0.01/GiB overage. [Volumes](https://www.digitalocean.com/pricing/volumes) supply $0.10/GiB-month additional disk. Snapshot backup storage uses the published $0.06/GB-month rate; backup schedules, retention and mandatory full-image size remain user assumptions.

## Hetzner

[Price adjustment effective June 15, 2026](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) supplies Singapore **new USD** hourly/monthly prices excluding IPv4/VAT: CPX12 0.0288/17.99, CPX22 0.0497/30.99, CPX32 0.0929/57.99, CPX42 0.1763/109.99. Historical 2024 launch prices and the old-price columns are excluded. [Regular Performance](https://www.hetzner.com/cloud/regular-performance/) supplies AMD/shared CPU, RAM, NVMe capacity and AP minimum transfer allowance. [Primary IP documentation](https://docs.hetzner.com/cloud/servers/primary-ips/overview/) supplies $0.001/hour capped at $0.60/month. [Billing FAQ](https://docs.hetzner.com/cloud/billing/faq/) confirms hourly rounding and capped billing even while stopped. Attached-volume and precise plan overage rates remain unimported.

## Frontier GPU references

**Runpod:** [Pricing updated October 8](https://www.runpod.io/pricing) publishes H100 SXM 80 GB at $3.99/hour with 20 vCPUs/125 GB RAM. [AP-IN-1 announcement](https://www.runpod.io/blog/new-runpod-datacenter-now-live-ap-in-1) confirms India H100 80 GB HBM3 deployment, without a matching regional quote. [Cloud GPU documentation](https://www.runpod.io/product/cloud-gpus) supplies no ingress/egress fees, per-second billing and standard network volume $0.07/GB-month under 1 TB. `diskMaxGb: 1000` conservatively bounds this published under-1-TB storage rate; larger disks produce an incomplete estimate. AP-IN-1 network-volume availability and allocation details need confirmation, so `regionalPricingVerified` is false. Public IPv4 pricing remains unknown.

**Lambda:** [Single-GPU pricing](https://lambda.ai/pricing) supplies H100 PCIe 80 GB, 26 vCPUs/225 GiB, $3.29/hour; RTX A6000 48 GB, 14 vCPUs/100 GiB, $1.09/hour. [On-demand documentation](https://docs.lambda.ai/public-cloud/on-demand/) lists India `asia-south-1` and explicitly says not every SKU is available in every region. Both references have `regionalPricingVerified: false`. Persistent-filesystem, IPv4 and egress rates are left unknown; root disks are not counted toward post-termination persistence.

**E2E Networks:** [India GPU product page](https://www.e2enetworks.com/gpu-cloud) supplies INR on-demand rates: L4 24 GB, 25 vCPU/110 GB RAM, ₹49/hour; H100 80 GB, 26 vCPU/250 GB, ₹362/hour; A100 80 GB, 16 vCPU/115 GB, ₹189/hour. It identifies Delhi NCR datacenters. The separate USD pricing page contains different tariffs; those are not mixed with these India INR rates. [GPU selection documentation](https://docs.e2enetworks.com/docs/myaccount/gpu/getting-started/choose-gpu-card/) confirms minute billing and that exact plan/location/persistence needs portal confirmation. Monthly committed prices are not on-demand caps. Missing storage, IPv4 and transfer prices deliberately keep full-job estimates incomplete.

## Exchange rates and refresh

[ExchangeRate-API open USD feed](https://open.er-api.com/v6/latest/USD), `time_last_update_utc = Thu, 15 Oct 2026 00:02:31 +0000`: INR **95.252751** and EUR **0.894425** per USD. Conversion is informational; provider invoice currency, card/bank rates and tax can differ. USD/INR billing tariffs are preserved separately.

Official authenticated catalogs can later verify Runpod/Lambda/E2E regional availability. Refresh jobs must preserve provenance, validate exact meters and retain the last valid snapshot on failure. A successful fetch does not verify capacity or make missing addons free. Any importer that updates only part of the catalog must retain per-offer review dates and must not present the whole snapshot as newly reviewed.
