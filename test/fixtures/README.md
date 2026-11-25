`study-24h.json.gz` contains Ethereum pool snapshots and normalized events for
2026-11-22 01:00 to 2026-11-23 01:00 UTC, plus results from a separate Python
implementation. The fixture has 145 archive observations, 1,165 swaps and
138 protocol buybacks matched to Flapper `Exec` events. It contains no keys.

Snapshot hashes are marked `fixture-math-only`; production collection fetches
and verifies actual block hashes. The fixture tests arithmetic and persistence,
not chain-canonicality checks.

`stusds-hour.json.gz` contains 13 canonical five-minute archive observations
and normalized Curve, pool-transfer and ERC4626 events for 2026-11-25
09:40–10:40 UTC (timestamps and hashes are embedded). Pool, proxy and
implementation identities are checked by the adapter before capture. Tests
reconcile both physical token balances, LP supply and whole-vault share issuance.
It contains public onchain data only; quotes include contemporaneous Curve fees.

`stusds-rpc.json.gz` records public JSON-RPC calls/results and a pinned live
snapshot at mainnet block 26,491,745. Replay tests verify price/rate/headroom,
route quotes and canonicality end to end, and inject unsupported upgrades,
reorgs and optional quote failures. No RPC URL or credentials are included.
