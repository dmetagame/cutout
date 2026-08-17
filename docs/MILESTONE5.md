# Milestone 5: Hackathon release candidate and integrator package

**Status:** ENGINEERING COMPLETE. Repository release, external deployment, and
npm publication are independently verifiable release actions.

Milestone 5 packages the frozen Milestone 1-4 implementation for integrators
and judges. It adds no scoring rule, transaction type, signing authority,
private-data path, or autonomous execution.

## Implemented release surface

- `@cutout/guard@0.1.1` with one explicit root export. `v0.1.0` remains the
  prior immutable repository release.
- Package build, exact export-surface tests, packed-tarball install, isolated
  TypeScript consumer typecheck, and executable example.
- Live canonical mainnet index advancement and non-submitting HTTP preflight
  smoke command.
- Full independent replay command for the historical Milestone 3 receipt.
- Judge-oriented README, demo runbook, release evidence, and security audit.
- Docker workspace support, production dependency pruning, capability drops,
  `no-new-privileges`, and configurable Compose env-file validation.
- Real Ready X `5.33.8` / Wallet API `0.10.3` simulation-only browser replay,
  stopped at `READY FOR CONFIRMATION` with no invoke request or transaction hash.

## Frozen behavior preserved

- `CUTOUT-v1.3` scoring unchanged.
- `FRESHNESS_POLICY-v1` unchanged.
- `GUARD_POLICY-v1` unchanged.
- Canonical indexer/reorg architecture unchanged.
- WalletAccountV6 simulation/submission boundary unchanged.
- Receipt verifier matching logic unchanged.

## Final verification record

| Check | Result |
|---|---|
| Full Node regression suite | 135 passed, 0 failed |
| Milestone 4 focused suite | 18 passed, 0 failed |
| Milestone 5 focused suite | 5 passed, 0 failed |
| Package public-API suite | 3 passed, 0 failed |
| Packed package consumer | passed installation, typecheck, and execution |
| Browser E2E | 7 passed, 0 failed |
| Root and web TypeScript checks | passed |
| Next.js production build | passed |
| Package dry run | 34 files, 17,654 bytes |
| Docker/Compose build and validation | passed |
| Production container security | UID 1000; capabilities dropped; no-new-privileges enabled |
| Runtime dependency inspection | TypeScript and Playwright absent; required Next/React runtime present |
| Production-like health and preflight | stale state 503; fresh state 200 and deterministic `LOW / ALLOW` |
| API restart durability | exact snapshot hash preserved |
| SQLite integrity/API access | `ok`; read-only/query-only API connection over WAL-capable volume |
| Dependency audit | 0 vulnerabilities |
| Diff whitespace check | passed |
| Historical Milestone 3 receipt replay | passed through independent public RPC |

The final live public-data smoke was `LIVE_MAINNET_NON_SUBMITTING` at block
`13,442,541`, snapshot
`0xf39aafdf488e51701a0531f6ef39a899f96d8b166b2439ee632ba60dec32cecb`,
with 23 seconds of index lag and 97 seconds of source age. It returned
deterministic `LOW / ALLOW`, produced decision ID
`0x4120452d92d03142a467cf89ceef28ac4d10016f6a604576b404a1584eaad085`,
and made no wallet or broadcast call. No transaction hash was produced and no
transaction was submitted.

The v0.1.1 browser smoke used Ready X `5.33.8`, Wallet API `0.10.3`, and one
`0.01 STRK` action against snapshot
`0x494e624cf0afd9ba4d2abd52ab61ded11f597052ec782cc42836b7cde54e1cb8`
at block `13,448,562`. Simulation completed and the flow stopped at
`READY_FOR_CONFIRMATION`. No invoke request, transaction hash, broadcast, or
submission occurred. This is distinct from the already completed Milestone 3
transaction.

The production-like container image was
`sha256:21386c74b373176f1c45472bf90aad87493a997976f9b808a331379e6950845b`.
It demonstrated persisted-state recovery, fail-closed stale health, a fresh
indexer sync, deterministic container preflight, and exact snapshot durability
through an API restart.

## External release blockers

- No target deployment host is configured or verified.
- `@cutout/guard` is not registry-published; publication requires an explicit
  owner decision and credentials.

No new mainnet transaction is required or permitted for this milestone.

## Completion decision

Milestone 5 engineering is complete. A Git tag proves repository release only;
it does not prove npm publication or target-host deployment. Those statuses are
reported independently and no deployment or registry publication is inferred
by this document.
