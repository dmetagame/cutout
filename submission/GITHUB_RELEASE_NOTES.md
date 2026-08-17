# CUTOUT v0.1.1

Cutout v0.1.1 is a focused Ready X timing and simulation reliability patch.
The existing v0.1.0 tag and release remain unchanged.

## Fixed

- Stabilized the browser's server-clock offset for the lifetime of a bootstrap
  response.
- Prevented delayed amount review from freezing the final intent timestamp and
  causing a valid final preflight to fail with `INVALID_INTENT`.
- Added an E2E regression that waits beyond the API timestamp tolerance and
  verifies that the final exact intent receives a newer timestamp.

No CUTOUT-v1.3 scoring rule, GUARD_POLICY-v1 rule, FRESHNESS_POLICY-v1 rule,
indexer contract, supported action, or signing authority changed.

## Fresh mainnet simulation evidence

- Ready X `5.33.8`
- Wallet API `0.10.3`
- Starknet Mainnet
- One typed `0.01 STRK` deposit
- Snapshot block `13,448,562`
- Snapshot `0x494e624cf0afd9ba4d2abd52ab61ded11f597052ec782cc42836b7cde54e1cb8`
- CUTOUT-v1.3 result `LOW / ALLOW`
- Final state `READY_FOR_CONFIRMATION`
- `wallet_strk20PrepareInvoke(..., simulate: true)` observed
- No invoke/broadcast method observed
- No transaction hash produced
- No transaction submitted

The historical Milestone 3 transaction remains separate evidence:
`0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e`.

## Verification

- 135 root tests
- 18 Milestone 4 focused tests
- 5 Milestone 5 focused tests
- 3 package API tests
- 7 browser E2E tests
- Root/web typechecks and production build
- Packed consumer verification
- `git diff --check`

Cutout remains a signing guard, not a privacy guarantee. The backend cannot
sign or broadcast, and users retain final wallet authority.
