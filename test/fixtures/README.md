`study-24h.json.gz` contains Ethereum pool snapshots and normalized events for
2026-11-22 01:00 to 2026-11-23 01:00 UTC, plus results from a separate Python
implementation. The fixture has 145 archive observations, 1,165 swaps and
138 protocol buybacks matched to Flapper `Exec` events. It contains no keys.

Snapshot hashes are marked `fixture-math-only`; production collection fetches
and verifies actual block hashes. The fixture tests arithmetic and persistence,
not chain-canonicality checks.
