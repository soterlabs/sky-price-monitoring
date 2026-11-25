# Token price monitoring PRD

Status: Approved for implementation  
Date: 25 November 2026

## 1 Purpose

Extend the existing SKY dashboard into one reusable codebase serving two public apps:

| App | Market | URL |
| --- | --- | --- |
| SKY monitor | SKY / USDS on Uniswap V2 | https://sky.soterlabs.com |
| stUSDS monitor | stUSDS / USDS on Curve | https://stusds.soterlabs.com |

Rename `soterlabs/sky-price-monitoring` to `soterlabs/token-price-monitoring` during implementation. Preserve the existing SKY app, data and domain. This PRD specifies the extension; writing it does not rename the repository or deploy an app.

The stUSDS app should answer: What is its market price? Who is buying, selling or redeeming? How much liquidity can support an exit? How does the Curve price compare with the vault redemption reference?

stUSDS is a share in a vault funding SKY-backed borrowing. Its share value can differ from one USDS, and its redemption availability depends on vault conditions. [Sky token documentation](https://developers.skyeco.com/protocol/tokens/stusds/)

## 2 Scope and product defaults

Reuse the current layout, charts, period selector, light/dark themes, mobile behavior, colored tooltips, full address links and latest-block Refresh behavior.

Three defaults adapt the product to stUSDS:

- Replace the SKY buyback card and headline with **Vault deposits and redemptions** and **Net vault deposits**. Displaying zero protocol buybacks would imply monitoring a program that has not been configured.
- Add **Market price versus redemption reference**, immediately after the stUSDS price card. This section appears only on stUSDS.
- Use stUSDS **shares** for holder retention. Yield-driven growth in their USDS value must not appear as token accumulation.

MVP covers Ethereum and the single identified Curve pool. Wallet connections, transaction execution, automated arbitrage, Slack alerts, additional pools and crosschain ownership reconstruction are outside this release.

## 3 Market configuration

| Setting | SKY | stUSDS |
| --- | --- | --- |
| Profile | `sky` | `stusds` |
| Token | `0x56072c95faa701256059aa122697b133aded9279` | `0x99cd4ec3f88a45940936f469e4bb72a2a701eeb9` |
| Quote token | USDS `0xdc035d45d973e3ec169d2276ddab16f1e407384f` | Same USDS token |
| Pool | `0x2621cc0b3f3c079c1db0e80794aa24976f0b9e3c` | `0x2c7c98a3b1582d83c43987202aeff638312478ae` |
| AMM | Uniswap V2 | Curve StableSwap NG |
| Pool coin order | SKY, USDS | USDS at index 0; stUSDS at index 1 |
| Buyback attribution | Existing verified Flapper logic | Disabled |
| Vault metrics | Disabled | ERC-4626 stUSDS vault |

The Curve pool is `factory-stable-ng-628`, named **USDS/stUSDS**. Its factory is `0x6a8cbed756804b16e05e741edabd5cb544ae21bf`. Factory lookup and pool coin getters confirmed this identity at Ethereum block **26,491,271**. Both tokens have 18 decimals; `stUSDS.asset()` returns USDS. The factory reports asset types `[0, 3]`, with stUSDS handled as ERC-4626. [Curve pool registry](https://api.curve.finance/v1/getPools/ethereum/factory-stable-ng)

Do not select the separate **sUSDS/stUSDS** pool, `0xb0cefac820228827a3f40deedbca88d5de44bca9`.

At startup and after contract changes, verify chain, token identities, decimals, vault asset, factory membership and supported implementation. Record implementation/code identity with snapshots. Stop the affected collector on an unsupported change while retaining labeled historical data.

## 4 Dashboard requirements

Keep four headline tiles in the existing order:

| Position | SKY | stUSDS |
| --- | --- | --- |
| 1 | SKY price in USDS | Curve stUSDS price in USDS |
| 2 | Net pool buying | Net pool buying |
| 3 | Protocol buybacks | Net vault deposits |
| 4 | Pool market value | Pool market value |

The body retains the current sequence, with one stUSDS-only insertion:

| Card | stUSDS requirements |
| --- | --- |
| Price | Curve spot over time; period price change; sampled period average; observed sampled high/low; drawdown and volatility at the selected sampling interval. A rate-adjusted Curve EMA may be a separately labeled overlay. |
| Market price versus redemption reference | Curve price and vault reference on one timeline, with a premium/discount chart in basis points, size-specific exit comparisons and immediate redemption headroom. |
| Buy / sell flow | USDS spent buying stUSDS and USDS received selling it; gross buys, gross sells, total volume, swaps, buy share and net buying. |
| Vault deposits and redemptions | Cumulative USDS deposited, USDS withdrawn and their net; total minted/burned shares, event counts, vault share supply and total assets. |
| Liquidity and trade impact | Both pool balances, pool value, imbalance, historical USDS reserves, liquidity-event flows and fee-inclusive buy/sell quotes for 10k and 100k USDS notionals. |
| Holder retention | Fixed initial top 100, next 900 and remaining address groups, indexed to 100 using aggregate share balances; net changes, new holders and address details. |
| Holder distribution | Balance buckets, snapshot slider, address count/share toggle, initial distribution outlines, top 10/100 shares and a clearly labeled tracked-holdings denominator. |
| Large holder activity | Separate Curve purchases, Curve sales, vault redemptions and known exchange deposits for the initial top 100. Deposits/mints remain separately identifiable. |
| Recent activity | Preserve the recent swaps table and transaction links. Add a separate vault-event view or tab showing deposits/redemptions, assets, shares and the event's owner/receiver. |

For SKY, preserve its buyback card, classification rules and current numerical results. stUSDS vault flows must never be mixed into Curve trading volume. Gains from share appreciation are not deposits or buys.

Vault flows cover the whole stUSDS vault; trading flows cover the selected Curve pool. Label those scopes beside their figures.

Flow tooltips show interval start and end in UTC. Holder details show full clickable addresses. Identify transaction senders, routers and token sources separately where relevant; router or bot activity alone does not establish a beneficial seller, retail participation or arbitrage.

## 5 Market and redemption calculations

### Curve market price

All displayed prices are **USDS per one stUSDS share**, with token decimals applied. Reserve ratios and the Uniswap constant-product formulas are not valid pricing methods for this market.

For this verified two-coin, 18-decimal configuration, the fee-free marginal price is:

```text
P_curve = (get_p(0) / 1e18) × stored_rates[1] / stored_rates[0]
```

Curve's `get_p(0)` uses normalized balances. Apply the rate conversion once. Verify the resulting marginal price against small executable bid/ask quotes, allowing for dynamic fees and price impact. Use the indexed getters `get_p(0)` and `price_oracle(0)` and obtain asset types from the factory. [Curve oracle implementation](https://docs.curve.finance/developer/stableswap-ng/pools/oracles/)

Curve's EMA is a different metric from the existing Uniswap cumulative-oracle TWAP. For MVP, label the stUSDS period statistic **Sampled time-weighted price**, estimated from five-minute endpoint prices using trapezoidal integration. Store its price-area and covered duration for aggregation. Label high/low as observed sampled spot prices. SKY retains its existing exact oracle TWAP. [Curve integration reference](https://docs.curve.finance/developer/integration/stableswap-ng/)

### Vault reference and price gap

At the same block as the Curve state, read:

```text
one_share = 10 ** share_decimals
R_nav = convertToAssets(one_share) / 10 ** asset_decimals
R_redeem = previewRedeem(one_share) / 10 ** asset_decimals
gap_bps = 10,000 × (P_curve / R_redeem − 1)
```

The primary label is **Vault redemption reference**. Store both reference values and expose their difference if fees or implementation changes make them diverge. Positive gap means a Curve premium; negative means a discount. Missing or zero reference values produce an unavailable gap rather than an invented price.

The comparison card shows:

- Current Curve spot, redemption reference, signed gap in bps and percent, and absolute difference in USDS per share.
- Historical market/reference lines and the gap, aligned to the same blocks and selected range.
- Current global unused redemption capacity in USDS, plus a capacity percentage with an explicit total-assets denominator.
- The largest observed discount/premium within available history, using the underlying five-minute observations.

Use enough price precision to make small gaps visible, with at least six decimals available for stUSDS prices and two decimals for basis points. Show positive dust capacity as less than the display threshold rather than implying an exact zero.

`previewRedeem` is a proceeds preview; ERC-4626 withdrawal limits are separate. The current stUSDS implementation limits exits by unused funds after outstanding borrowing and liquidation obligations. Derive global headroom from its deployed accounting, with the correct accrual and rounding; corroborate against `maxWithdraw(owner)` and `maxRedeem(owner)` for known funded holders. A holder-specific maximum is not automatically the global capacity. Raw USDS balance alone is not the capacity calculation. [ERC-4626 specification](https://eips.ethereum.org/EIPS/eip-4626), [stUSDS implementation](https://github.com/sky-ecosystem/stusds/blob/master/src/StUsds.sol)

For a share quantity `q`, compare the same shares on both routes:

```text
curve_proceeds(q) = get_dy(1, 0, q)
vault_preview(q) = previewRedeem(q)
exit_gap_bps(q) = 10,000 × (curve_proceeds(q) / vault_preview(q) − 1)
```

Use the existing 10k/100k USDS notional controls. Sell quantities are valued at Curve spot, rounded down; display the actual share input. Vault previews do not establish that a hypothetical holder has sufficient shares, allowance or redemption capacity. Show the capacity check separately. A discount is not a guaranteed executable arbitrage.

### Liquidity and execution quotes

Use `get_dy(0,1,assets_in)` for buys and `get_dy(1,0,shares_in)` for sells. Quotes include the pool's current dynamic fees and price impact; gas and MEV remain excluded. Quote failure affects that size/route, not the entire dashboard. [Curve quoting and fees](https://docs.curve.finance/developer/integration/stableswap-ng/#quoting-swap-amounts)

Calculate pool market value as `USDS_balance + stUSDS_balance × P_curve`. Show reference value using `R_nav` separately when useful. Do not use SKY's `2 × USDS reserve` shortcut or Curve LP virtual price as the stUSDS redemption value. Distinguish AMM-accounted balances from raw token/admin-fee balances when reconciling state. [Curve pool implementation](https://github.com/curvefi/stableswap-ng/blob/main/contracts/main/CurveStableSwapNG.vy)

## 6 Flow and holder accounting

Curve buys/sells come from the verified pool's exchange events and actual USDS amounts. Parse the deployed ABI, including supported liquidity event variants. Reconcile transfers, AMM balances, LP changes and admin-fee movements. Record parameter/rate changes that affect pricing. A changing ERC-4626 reference rate does not itself create swap volume.

Vault deposits/redemptions come from ERC-4626 `Deposit`/`Withdraw` events. Reconcile them with share mint/burn transfers; count each operation once. Persist assets, shares, caller, owner/receiver, transaction and log index. A receipt can contain both a vault action and a Curve trade; retain both event types without treating them as two Curve trades.

Build the stUSDS holder ledger from share transfers starting at vault deployment. Verify supply as previous supply plus mints minus burns, and reconcile address balances onchain. Preserve fixed cohort membership within each selected period, including holders whose balance reaches zero. Show underlying USDS reference exposure only as a distinct optional measure.

Use profile-specific custody exclusions. Display tracked holdings, excluded custody totals and total share supply distinctly. Keep direct holders and protocol custody separate; attribute wrapper-held shares to users only where a verified adapter supports that attribution. Do not reuse SKY's Lockstake/governance look-through logic for stUSDS or double-count vault assets as share holdings. Known exchange deposits remain potential sales, not confirmed executions.

## 7 Periods and refresh behavior

| Selector | Display interval | Browser polling |
| --- | --- | --- |
| Last 60min | 5 minutes | 5 minutes |
| Last 24h | 10 minutes | 10 minutes |
| 7 days | 10 minutes | 10 minutes |
| 30 days | Daily | 10 minutes |
| 90 days | Daily | 10 minutes |
| 180 days | Daily | 10 minutes |

Keep Last 24h as each app's configurable default through `DASHBOARD_DEFAULT_PERIOD`.

Each stored observation includes block number/hash/time and raw integer values for:

| Dataset | Required observations |
| --- | --- |
| Curve | Coin metadata, implementation, accounted balances, rate multipliers, amplification/fee settings, marginal price, EMA and size-specific swap quotes. |
| Vault | Share supply, total assets, conversion/redemption previews, and the accrual/debt/liquidation state needed to reproduce unused redemption capacity. |
| Events | Exchanges, liquidity operations, vault deposits/withdrawals and share transfers, keyed by chain, transaction and log index. |
| Holders | Reconciled share balances, supply changes, custody classifications and per-range cohort definitions. |

Pricing and accounting use onchain reads. Curve's API supports discovery; it is not the authority for historical market prices or vault references.

Capture five-minute confirmed snapshots for pool state, vault references, capacity and holder state. Ten-minute views use complete pairs; daily views preserve volume sums and weighted price statistics. Each range ends at its own closed boundary. Rewind holder state to that boundary when the latest ledger checkpoint is newer.

Refresh reads the latest block for price, reserves, execution quotes, vault references, capacity and gap without writing snapshots. All related live values use one block and show its number/time. Historical charts and period totals remain based on saved data. A failed live read retains labeled saved values.

For launch, populate the last hour first and backfill seven days of pool/vault history, limited by contract deployment. Index holders from vault deployment with resumable checkpoints. Longer ranges grow forward and show coverage explicitly. Holder indexing must not prevent the pool/vault price cards from becoming usable.

## 8 Shared repository and deployment

Use one codebase and Docker image with two configured market profiles. Share chart components, formatting, period logic, persistence interfaces, RPC batching, retries and health reporting. Implement distinct Uniswap V2, Curve StableSwap NG and ERC-4626 adapters; preserve protocol-specific mathematics.

Deploy independent web, collector and daily-rollup services for each market. Each collector runs every five minutes; daily aggregation remains scheduled once daily. Keep the existing SKY service identities and domain.

Reuse the existing PostgreSQL cluster with a separate stUSDS schema. Retain existing SKY schema/table names and history; let the repository layer abstract legacy names. Connections, tables, checkpoints, jobs and advisory locks must be scoped to the configured market. Include market, chain, pool and metric version in persisted provenance and API responses. Validate profile/schema configuration against an allowlist rather than request input.

Use `MARKET_PROFILE=sky` or `stusds`; default existing SKY deployments to `sky`. Cache keys and price/holder exclusions must remain profile-specific. An stUSDS job failure must not overwrite SKY health or checkpoints.

Repository rename tasks include Git remotes, CI references, README/footer links, Railway GitHub sources and webhook integration. Verify ongoing deployments rather than relying on GitHub redirects.

Expose the new web service through a Railway custom domain at `stusds.soterlabs.com`. Use Railway CLI and Cloudflare CLI for the returned CNAME and any verification record. Preserve `sky.soterlabs.com`, verify DNS/TLS and confirm each hostname serves the intended profile. Credentials remain server-side Railway variables and ignored local environment files.

## 9 Reliability and acceptance criteria

Existing archive RPC and twelve-confirmation defaults remain. Use atomic, resumable collection with canonical block checks and adaptive log ranges. Backfill, pool, vault and holder health are independent. Retain current stale thresholds: 15 minutes for Last 60min and 25 minutes for other views. A current price with stale vault reference cannot produce a fresh-looking gap.

The release is accepted when:

1. SKY historical fixtures, live Refresh and all current ranges pass regression checks after refactoring.
2. Host/profile and database isolation tests show no cross-market reads, writes, health-state or checkpoint collisions.
3. stUSDS displays twelve five-minute bars and thirteen holder snapshots for a fully populated Last 60min window; 24h/7d retain ten-minute sampling and longer ranges daily sampling.
4. Curve and vault values share block provenance. Price units are verified against executable quotes; signed gaps, decimals and rounding are tested.
5. Zero/limited redemption capacity, a valid preview with an unavailable exit, fee changes, unavailable quotes and zero reference values display correctly.
6. Swap, vault and share ledgers reconcile independently. Minting, redemption, LP flows and yield accrual do not manufacture Curve buying/selling or holder accumulation.
7. Five-to-ten-minute aggregation preserves volumes and metric definitions; midnight, reorg recovery and older range closing boundaries pass tests.
8. Phone/desktop, theme, colored tooltips, UTC interval labels, sliders, full address links and API failures pass browser checks.
9. Both HTTPS domains serve their intended markets. Two consecutive five-minute collections and a daily-rollup run succeed with clear freshness/coverage metadata.

### Price normalization fixture

At Ethereum block **26,491,271**, 25 November 2026 09:22:35 UTC, the identified pool/vault returned approximately:

| Quantity | Value |
| --- | --- |
| Raw `get_p(0) / 1e18` | 0.9191776171 |
| stUSDS `convertToAssets(1e18) / 1e18` | 1.0928731433 USDS |
| Rate-adjusted marginal Curve price | 1.0045445317 USDS/stUSDS |
| Market/reference gap | −808.22 bps |
| `get_dy(1,0,1e18) / 1e18` | 1.0017534604 USDS after pool fees/impact |

Use this historical block as an implementation fixture. The raw Curve number is not a USDS-per-share quote, and the fee-inclusive sell quote is a different measure from marginal spot. Runtime values must always be fetched for the requested block.

## 10 Delivery and rollback

1. Extract the shared profile/adapters layer and establish SKY regression parity.
2. Add isolated stUSDS storage, Curve/vault collectors, holder indexing and the redemption comparison section.
3. Populate and verify historical data and both app profiles in a staging deployment.
4. Rename the repository and update source integrations while preserving SKY availability.
5. Publish the stUSDS hostname and validate native scheduled runs, DNS, TLS and both apps.

Keep schema changes additive and SKY's existing data readable by its previous release. Roll back a faulty app to its previous image and pause only its affected collectors; preserve collected records and the other market's operation.

## 11 Decisions for implementation

No additional inputs are required to use this PRD as a build specification. The defaults to confirm during product alignment are the vault-flows replacement for the buyback card, the clearly labeled sampled price average for Curve, seven days of initial history, and shared PostgreSQL with separate market schemas. An explicitly preferred alternative can replace any of these before implementation.
