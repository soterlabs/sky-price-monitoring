# Token price monitoring

A minimal public dashboard for the Ethereum [SKY/USDS Uniswap V2 pool](https://etherscan.io/address/0x2621cc0b3f3c079c1db0e80794aa24976f0b9e3c), built by Soter Labs.

[SKY dashboard](https://sky.soterlabs.com) · [stUSDS dashboard](https://stusds.soterlabs.com)

One image serves two fixed market profiles. `MARKET_PROFILE=sky` is the default; `stusds` selects the Curve USDS/stUSDS pool and ERC4626 vault. SKY keeps its original public tables; stUSDS uses an isolated `stusds` PostgreSQL schema and separate locks and jobs.

Four cards show price and true oracle TWAP, buy/sell USDS flows, verified protocol buybacks, and pool liquidity with execution quotes. Volume, drawdown, volatility and recent swaps provide context. Prices are **USDS per SKY**, not an independently verified USD quote. Light/dark themes and mobile layouts are supported.

## Data and schedules

| Service | Schedule (UTC) | Work |
| --- | --- | --- |
| `sky-price-monitoring` | Always running | Read-only dashboard and JSON API |
| `sky-collector` | `*/5 * * * *` | Index swaps and liquidity events; persist archive snapshots and five-minute aggregates |
| `sky-daily-rollups` | `25 0 * * *` | Materialize UTC daily aggregates; retry missing or invalidated days |
| `Postgres` | Persistent | Snapshots, raw normalized events, mixed legacy ten-minute / new five-minute records, daily records and job health |

First collection backfills **seven days**. It commits resumable six-hour segments. The `60m` range uses five-minute points. The `24h` and `7d` ranges retain ten-minute points by aggregating pairs of five-minute records. The `30d`, `90d` and `180d` ranges use daily points, with recent days derived from current interval data and today marked provisional. Longer histories grow from the initial backfill; the UI explicitly identifies incomplete coverage.

The collector reads 12 confirmations behind the head and only commits full five-minute intervals. Overlapping reruns replace events and aggregates atomically. A database advisory lock prevents concurrent collectors. Before resuming, it checks the saved block hash and can rewind to a canonical anchor within the previous day. Data stops advancing, and the dashboard shows an issue, if verification fails.

Each collection segment verifies:

- Ethereum chain ID, token identities/decimals and the canonical Uniswap V2 factory pair.
- Every configured Flapper buyback against its `Exec(lot,bought)` event.
- Swap/mint/burn token deltas against opening and closing reserves.
- Event-integrated TWAP against Uniswap's cumulative-price oracle.

Same-asset flash repayments do not count as directional buying or selling. Daily volumes are sums; daily TWAPs are duration weighted. The website reads stored data and does not trigger RPC backfills in response to visitors.

## Indicators

- **Price:** spot, selected-period change, TWAP, high/low, closing-price drawdown and nonannualized close-to-close volatility.
- **Pressure:** USDS paid into the pool for SKY versus USDS paid out; net flow and the buy share of notional volume. “Other” flows include arbitrage/MEV and are not labeled organic demand.
- **Buybacks:** USDS spent, SKY purchased, executions, share of buy volume and cumulative contribution versus other net flows.
- **Liquidity:** both token reserves, pool-marked value (`2 × USDS reserve`), liquidity-event token flow, and execution-price differences for 10K/100K USDS-equivalent trades. Quotes include the 0.30% V2 fee, exclude gas/MEV and use the latest saved state. Falling value alone does not establish LP withdrawals.

## Run locally

Requires Node 22+, PostgreSQL 17+ and an Ethereum archive RPC with `eth_getLogs` and historical `eth_call`.

```sh
npm ci
cp .env.example .env
# Set DATABASE_URL and ETH_RPC in .env.
npm run build
node --env-file=.env dist/collector.js
node --env-file=.env dist/daily.js
node --env-file=.env dist/server.js
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `MARKET_PROFILE` | `sky` | `sky` or `stusds`; fixed per service |
| `DATABASE_URL` | Required | PostgreSQL connection |
| `ETH_RPC` | Required | Ethereum archive endpoint; kept out of source control |
| `DASHBOARD_DEFAULT_PERIOD` | `24h` | One of `60m`, `24h`, `7d`, `30d`, `90d`, `180d` |
| `BACKFILL_DAYS` | `7` | Initial collection lookback (1–180); does not trim existing history |
| `CONFIRMATIONS` | `12` | Blocks behind head before collection |
| `PORT` | `3000` | Web listener |

`GET /api/dashboard?range=24h` returns metrics, points, coverage, job health and recent swaps. `GET /healthz` checks the database. Data freshness is separate from HTTP health; saved data older than 15 minutes for `60m` or 25 minutes for other ranges or a failed collector check is marked stale. The API is cached in memory for 15 seconds.

## Validation

```sh
npm run typecheck
TEST_DATABASE_URL=postgresql://... npm test
npx playwright install chromium
npm run test:e2e
```

The included public-chain fixture reproduces a separate Python study of 1,165 swaps and 138 buybacks over 24 hours. Tests cover exact volume, TWAP, flash repayments, missing-event rejection, daily aggregation, PostgreSQL idempotence and locking, and mobile/desktop interactions. Browser tests use intercepted fixture data, independently of production databases. CI runs both PostgreSQL integration and browser checks.

## Railway

The tracked `.railway/railway.ts` describes the web service, two cron jobs and database. Variables are deliberately unmanaged by IaC; configure them with Railway's variable CLI or dashboard. Preview `railway config plan` before applying changes.

- All three app services: `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
- Web: set `ETH_RPC` and `DASHBOARD_DEFAULT_PERIOD=24h`.
- Jobs: `ETH_RPC=${{sky-price-monitoring.ETH_RPC}}`.
- Collector: `BACKFILL_DAYS=7`, `CONFIRMATIONS=12`.

GitHub `main` is the deployment source. The Docker image's default command starts the web server; cron services override it with `npm run collect` and `npm run rollup` and exit when done. Trigger initial jobs with `railway cron run --service sky-collector --yes`, then `sky-daily-rollups`.

The Refresh button additionally reads the latest Ethereum block for live price,
reserves and execution quotes, without writing to Postgres. Charts, price change,
trading flows and buybacks remain based on saved intervals. Live values show their
own block timestamp and revert to saved values on the next ordinary refresh.

### Holder history

The existing five-minute collector also advances a resumable SKY holder index,
with its own advisory lock and a five-minute work budget. The first run scans
from SKY deployment (block 20,663,735); subsequent runs resume atomic checkpoints.
Views appear only after raw SKY balances reconcile to total supply and attributed
Lockstake positions reconcile to lsSKY supply. Pool collection runs first and
has separate freshness/error reporting.

Holder charts share the pool's exact confirmed snapshot blocks: five-minute
points for 60m, ten-minute points for 24h/7d and UTC daily points for longer ranges. Available history is
explicit. The initial top 100, next 900 and remaining addresses stay fixed for
the selected window; new holders are reported separately. Retention measures
aggregate token holdings, not cost basis or the percentage of original tokens
never sold (selling and rebuying can produce the same balance).

Lockstake receipt mint/burn events are credited to the owner recorded in `Open`.
Chief deposit/withdrawal events and VoteDelegate stake events attribute governance
holdings to the depositor; engine and delegate custody is excluded to avoid double
counting. Contract identities are checked onchain against SKY. Known reserves,
converters, the tracked pool, vesting, burn and selected exchange addresses are
excluded in `src/holders.ts`; this is a conservative, incomplete label set, not
entity clustering. Other pools, exchanges or custody can remain unclassified.

Activity covers the fixed top 100. A confirmed trade requires a direct SKY
transfer to/from the monitored pool and a same-transaction directional Swap;
transactions with both buy and sell swaps are left unclassified. This does not
cover every DEX, router or exchange. Exchange deposits indicate possible selling,
not executed sales. Addresses and smaller balances cannot establish retail identity.

`GET /api/holders?range=24h` serves stored aggregate views; it does not rescan the
chain in a request. Holder indexing failures leave prior views visible with an
explicit timestamp and error. Genesis replay is covered by a Postgres integration
test, including refusal to publish an unreconciled ledger and checkpoint reuse.
Pool-transfer totals must also reconcile exactly to Swap SKY input/output totals
within the transaction; mixed liquidity operations and donations are unclassified.
Before publishing, each tracked nonzero address is checked with historical
`SKY.balanceOf` on initial catch-up; later runs check all changed addresses,
including those reduced to zero. Supply totals alone cannot detect a missing
ordinary transfer, so this provides a separate per-address reconciliation.

On upgrade, the collector rereads at least the last hour at five-minute boundaries.
Older ten-minute history remains valid. Ten-minute views end on ten-minute UTC
boundaries even when the newest five-minute checkpoint ends at :05. Holder views
rewind the ledger to that range's exact end block. The Last 60min page polls every
five minutes; other ranges keep their existing ten-minute polling.

## stUSDS profile

The second dashboard follows [Curve USDS/stUSDS](https://etherscan.io/address/0x2c7c98a3b1582d83c43987202aeff638312478ae)
and the [stUSDS ERC4626 vault](https://etherscan.io/address/0x99cd4ec3f88a45940936f469e4bb72a2a701eeb9).
It retains price, buy/sell flow, liquidity and all three holder cards. Vault
**deposits and redemptions** replace SKY protocol buybacks. These are whole-vault
ERC4626 flows, not Curve buys/sells. Recent swaps and vault events are separate.

An additional card compares the same-block Curve market price with
`previewRedeem(1e18)` in USDS/share. `convertToAssets(1e18)` is shown separately.
Positive basis points mean a market premium; negative mean a discount. A preview
is not executable liquidity: global unused redemption capacity is derived from
accrued vault assets less accrued borrowing and outstanding liquidation debt,
and checked against owner-specific `maxWithdraw` and `maxRedeem` views.

Curve `get_p(0)` and its EMA are **rate normalized**. Both are multiplied by the
stored stUSDS rate to obtain USDS/share. Curve averages are approximate trapezoid
averages of five-minute observations, not Uniswap cumulative-oracle TWAPs.
High/low and gap extrema are sampled. Price impact uses historical `get_dy`
quotes with dynamic fees. For 10K/100K USDS market notionals, the sell quote and
vault preview use identical share inputs. Quote reverts show unavailable values.
Pool value is `USDS + stUSDS × market price`, not a V2 reserve shortcut.

Every segment reconciles physical token transfers, LP supply and vault issuance.
Mint/burn transfers must match Deposit/Withdraw events. Contract, implementation,
asset type, rate and owner-limit checks halt collection on unsupported behavior.
Raw/LP transfers, exchanges, liquidity operations, parameter changes and vault
events retain transaction-level provenance in the event ledger. Non-swap flows
are not counted as buy/sell volume. Unknown upgrades stop fresh publication.

Holder history replays all stUSDS share transfers from deployment block 23,219,535.
Supply and per-address balances reconcile before views publish. Cohorts and
buckets use **share units**, so yield accrual cannot create retention. Verified
share burns matched to vault Withdraw events appear as redemptions separately
from Curve sales. Pool and labeled custody balances are excluded and shown
alongside issued supply. Labels remain incomplete; addresses are not entities.

`stusds-price-monitoring`, `stusds-collector` and `stusds-daily-rollups` all require
`MARKET_PROFILE=stusds`, the same database reference and archive RPC reference as
SKY. The collector runs every five minutes to support Last 60min; other short
ranges aggregate to ten minutes. Daily rollups run at 00:35 UTC. Fresh collection
runs before a resumable seven-day backfill and bounded holder-genesis replay.
Backfill and holder health are tracked independently. A read-only live Refresh
updates price, NAV/reference, capacity and quotes without writing snapshots.

See [the approved PRD](docs/PRD_TOKEN_PRICE_MONITORING.md). Renaming the GitHub
repository preserves the SKY Railway service IDs, custom domain and database.
