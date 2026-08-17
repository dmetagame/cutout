# Cutout Release Manifest

**Prepared:** 2026-08-17
**Release identity:** `v0.1.0`; the commit resolved by the annotated tag is authoritative

## Identity

| Field | Value |
|---|---|
| Parent commit before release | `c10b8cf67761de92c30231477a2d460e2cb4ea9c` |
| Repository tag | `v0.1.0` |
| Package | `@cutout/guard@0.1.0` |
| Package API | `CUTOUT_GUARD_API-v1` |
| Engine | `CUTOUT-v1.3` |
| Guard policy | `GUARD_POLICY-v1` |
| Freshness policy | `FRESHNESS_POLICY-v1` |
| Receipt schema | `CUTOUT_RECEIPT-v1` |
| Network | Starknet Mainnet (`0x534e5f4d41494e`) |
| Pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

The release commit is intentionally identified by the annotated tag rather
than embedded in this file: changing a file to contain its own commit hash
would change that hash. Resolve it with `git rev-parse v0.1.0^{commit}`.

## Milestone record

| Milestone | Recorded state |
|---|---|
| 1 | Complete: live STRK20 ingestion, deterministic engine, and real Ready X simulation boundary verified. |
| 2 | Complete: incremental SQLite indexer, canonical snapshots, reorg recovery, and fail-closed preflight API. |
| 3 | Complete: one explicitly authorized mainnet deposit and independent public receipt verification. |
| 4 | Complete: production-like local supervision, persistence, failover, health, backup, and container hardening. |
| 5 | Engineering complete: integrator package, release audit, live non-submitting smoke, and judge package prepared. |

## Latest live smoke

This is a fresh `LIVE_MAINNET_NON_SUBMITTING` public-data smoke, not the
Milestone 3 transaction.

| Field | Value |
|---|---|
| Observed/indexed block | `13,442,541` |
| Observed block hash | `0xdcecc6452f265d6d556b299e76bac17b2f0dc71121824063b92c9b44ce0766` |
| Observed/indexed timestamp | `1786981090` |
| RPC head block | `13,442,555` |
| RPC head hash | `0x5192f7745e72d9ab7bf27ea65358fa2ad5a10eb2387c2e85210b1ae138e732c` |
| RPC head timestamp | `1786981113` |
| Snapshot hash | `0xf39aafdf488e51701a0531f6ef39a899f96d8b166b2439ee632ba60dec32cecb` |
| Index lag | `23 seconds` |
| Source age | `97 seconds` |
| Decision | `LOW / ALLOW` |
| Decision ID | `0x4120452d92d03142a467cf89ceef28ac4d10016f6a604576b404a1584eaad085` |
| Broadcast method | Not invoked |
| Transaction hash | Not produced |
| Transaction submission | None |

## Historical Milestone 3 transaction

| Field | Value |
|---|---|
| Transaction | `0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e` |
| Action | One `0.01 STRK` deposit |
| Status | `SUCCEEDED / ACCEPTED_ON_L2` |
| Block | `13,427,531` |
| Snapshot | `0xbe131fcf5f63309e40b8e3656465e56bac7f5b8a1b8d5336974071bfabc34acf` |
| Receipt artifact | `0x09adfe7664898666360052a35a9e3551e1c343c14fff37ea6d6fafb9046d643c` |

This transaction is historical evidence only and was not reused as the
Milestone 5 smoke test.

## Verification record

| Check | Result |
|---|---|
| Root regression suite | `135 passed, 0 failed` |
| Milestone 4 focused suite | `18 passed, 0 failed` |
| Milestone 5 focused suite | `5 passed, 0 failed` |
| Package public API suite | `3 passed, 0 failed` |
| Packed consumer install/typecheck/run | Passed |
| Browser E2E | `6 passed, 0 failed` |
| Root/web typechecks | Passed |
| Next.js production build | Passed |
| Package dry run | `34 files`, `17,652 bytes` |
| Docker/Compose validation | Passed |
| Dependency audit | `0 vulnerabilities` |
| `git diff --check` | Passed |

## Deployment and security state

Docker/Compose was verified as a production-like local deployment with a
persistent SQLite volume, one indexer writer, read-only/query-only API access,
RPC failover, health checks, an unprivileged runtime, dropped capabilities, and
`no-new-privileges`. No external target host or HTTPS endpoint has been
configured or verified.

No private keys, seed phrases, viewing keys, notes, proof material, shielded
balances, backend signing, or Milestone 5 transaction submission are included
in this release.

## Release commit file set

The exact paths included in the release commit are listed below. Ignored local
state such as `data/`, `dist/`, `.next/`, `node_modules/`, package build output,
Playwright output, `.env`, and Python bytecode is deliberately excluded.

<!-- FILE_LIST_START -->
```text
.dockerignore
.env.example
.github/workflows/ci.yml
.gitignore
Dockerfile
README.md
apps/web/app/_components/receipt-view.tsx
apps/web/app/_components/signing-workflow.tsx
apps/web/app/api/health/route.ts
apps/web/app/api/preflight/route.ts
apps/web/app/globals.css
apps/web/app/layout.tsx
apps/web/app/page.tsx
apps/web/app/receipt/[receiptId]/page.tsx
apps/web/e2e/signing-workflow.spec.ts
apps/web/e2e/wallet-harness.ts
apps/web/lib/server-runtime.ts
apps/web/lib/types.ts
apps/web/next-env.d.ts
apps/web/next.config.ts
apps/web/playwright.config.ts
apps/web/tsconfig.json
compose.yaml
docs/DEMO_RUNBOOK.md
docs/DEPLOYMENT.md
docs/ARCHITECTURE.md
docs/FINAL_SECURITY_REVIEW.md
docs/FRESHNESS_POLICY.md
docs/GUARD.md
docs/GUARD_POLICY.md
docs/HEALTH.md
docs/INDEXER.md
docs/INTEGRATOR.md
docs/MAINNET_SPIKE.md
docs/MILESTONE3.md
docs/MILESTONE4.md
docs/MILESTONE5.md
docs/OPERATIONS.md
docs/PREFLIGHT_API.md
docs/RECEIPTS.md
docs/RELEASE_AUDIT.md
docs/RELEASE_EVIDENCE.md
docs/RELEASE_MANIFEST.md
docs/REORG_HANDLING.md
docs/SECURITY.md
docs/SIGNING_WORKFLOW.md
docs/SNAPSHOT.md
examples/guard-consumer/README.md
examples/guard-consumer/index.ts
examples/guard-consumer/tsconfig.json
fixtures/indexer/replay.json
fixtures/pool-abi.json
package-lock.json
package.json
packages/guard/README.md
packages/guard/package.json
packages/guard/test/public-api.test.mjs
packages/guard/tsconfig.json
scripts/backup-database.ts
scripts/indexer.ts
scripts/mainnet-spike.ts
scripts/preflight-api.ts
scripts/release-smoke.ts
scripts/seed-milestone3.ts
scripts/test-package-consumer.mjs
scripts/verify-release-receipt.ts
submission/DEMO_SCRIPT.md
submission/GITHUB_RELEASE_NOTES.md
submission/JUDGE_FAQ.md
submission/PITCH.md
submission/README.md
src/api/canonical.ts
src/api/http.ts
src/api/preflight.ts
src/api/types.ts
src/guard-package.ts
src/index.ts
src/indexer/errors.ts
src/indexer/indexer.ts
src/indexer/store.ts
src/indexer/types.ts
src/operations/config.ts
src/operations/health.ts
src/operations/indexer-supervisor.ts
src/operations/metrics.ts
src/operations/rpc-failover.ts
src/starknet/abi.ts
src/starknet/actions.ts
src/starknet/config.ts
src/starknet/errors.ts
src/starknet/events.ts
src/starknet/felt.ts
src/starknet/freshness.ts
src/starknet/ingest.ts
src/starknet/policies.ts
src/starknet/preflight.ts
src/starknet/rpc.ts
src/starknet/snapshot.ts
src/starknet/types.ts
src/starknet/wallet-execution.ts
src/starknet/wallet.ts
src/workflow/amounts.ts
src/workflow/canonical.ts
src/workflow/guard.ts
src/workflow/preflight-client.ts
src/workflow/receipt.ts
src/workflow/types.ts
tests/helpers/replay-rpc.ts
tests/milestone2.test.ts
tests/milestone3.test.ts
tests/milestone4.test.ts
tests/milestone5.test.ts
tests/starknet-spike.test.ts
tsconfig.json
```
<!-- FILE_LIST_END -->

## Release procedure

```text
git add <release commit file set>
git commit -m "Prepare Cutout v0.1.0 release candidate"
git tag -a v0.1.0 -m "Cutout v0.1.0"
```

Verify the resulting identities with `git rev-parse v0.1.0^{commit}` and
`git rev-parse v0.1.0^{tag}`. Target-host deployment and npm publication remain
separate actions and are never inferred from this repository tag.
