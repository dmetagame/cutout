# Final release and security audit

**Review date:** 2026-08-20

This review treats CUTOUT-v1.3, FRESHNESS_POLICY-v1, GUARD_POLICY-v1, the
canonical indexer, WalletAccountV6 flow, and receipt binding as frozen
foundations. No scoring or signing behavior was changed.

## Findings

| Area | Result | Evidence |
|---|---|---|
| Signing authority | PASS | Submission remains isolated in the browser wallet adapter; server/indexer routes cannot import it. |
| Backend signing/broadcast | PASS | No server route owns a wallet account or invokes a submission method. |
| Private material | PASS | No private-key, seed, viewing-key value, note, proof, or shielded-balance path is present. |
| Action boundary | PASS | One exact `deposit` only; mixed, transfer, withdraw, invoke, and arbitrary calldata fail closed. |
| Snapshot integrity | PASS | Stale, partial, corrupt, hash-inconsistent, reorging, and schema-uncertain snapshots cannot produce `LOW / ALLOW`. |
| RPC failover | PASS | Both providers are chain-checked and common-block cross-checked; disagreement fails closed. |
| Pool schema | PASS | Reviewed class hash and ABI selectors are required; unexpected changes return `POOL_SCHEMA_MISMATCH`. |
| Amount bounds | PASS | Positive u128 base units, target/min/max order, displayed amount, selected recommendation, and final exact intent are bound. |
| Recommendation | PASS | Existing deterministic engine only; no out-of-range or fabricated candidate path. |
| Receipt binding | PASS | Public receipt must match transaction, account, pool, token, amount, selector, block, and success/finality state. |
| Telemetry | PASS | Server logs and metrics omit raw account, amount, and intent bodies. |
| Package surface | PASS | One root export; no indexer, DB, RPC runtime, wallet submission, or engine execution export. |
| Container permissions | PASS | Non-root user, capability drop, `no-new-privileges`, SQLite read-only/query-only API connection, pruned dev dependencies. The shared volume is writable only because WAL readers require SHM coordination. |
| Backup/recovery | PASS | Online SQLite backup and deterministic restore/restart paths are tested. |

## Dependency and secret review

- Runtime versions are pinned for Starknet, Next.js, React, and wallet discovery.
- `npm audit --omit=dev --audit-level=high` is a release gate.
- `.env` and data/backup files are ignored; `.env.example` contains no secret.
- Server RPC credentials must never use a `NEXT_PUBLIC_` prefix.
- `CUTOUT_BROWSER_RPC_URL` is intentionally public and must not contain a
  credential.
- The package's only runtime dependency is the already-pinned
  `starknet@10.4.0`, used for canonical Starknet address validation.

## Release-time blockers outside code

1. At the v0.1.2 release audit, no external deployment target or HTTPS endpoint
   had been verified. Local Docker evidence was not treated as a public
   deployment.
2. Publishing `@cutout/guard` to a registry requires repository-owner package
   credentials and an explicit publish decision. The tarball itself is tested.

The deployment blocker was resolved after the release audit. The current
production deployment is independently verified at
`https://cutout.rouma.online` for release `v0.1.4`. Deployment health and
freshness remain time-dependent operational facts; the live endpoint is not
evidence of npm publication.

## v0.1.4 final patch review

The v0.1.4 patch is presentation-only. It adds Lenis `1.3.26`, GSAP `3.15.0`,
and `@gsap/react` `2.1.2` behind client-only lifecycle boundaries. Enhanced
motion is gated by `prefers-reduced-motion: no-preference`; reduced-motion
users receive native scrolling, no hidden information, and the same signing
states. The motion system animates entrances, workflow transitions, evidence
reveals, and receipt presentation without changing the underlying state
machine.

The release diff was reviewed against the frozen security boundary. It changes
no CUTOUT-v1.3 scoring, GUARD_POLICY-v1, FRESHNESS_POLICY-v1, indexer or
snapshot semantics, preflight API behavior, database behavior, receipt
verification, transaction construction, or wallet execution semantics. The
wallet fixture still reports `connectCalls=1`, `prepareCalls=1`,
`invokeCalls=0` and produces no transaction hash.

The production UI smoke covered Propose, Verify, Review, simulation,
`READY_FOR_CONFIRMATION`, receipt, unavailable/fail-closed, responsive, focus,
and reduced-motion states at 1440, 1024, 768, 430, and 390px. No console
errors, failed requests, or horizontal overflow were observed. During live
RPC synchronization, the service correctly exposed unavailable states without
a decision or risk band, then recovered after a complete snapshot stabilized.

No release-blocking security defect was found. npm publication remains an
owner-authorized external action and was not attempted because `npm whoami`
returned `401 Unauthorized`.

## v0.1.3 final patch review

The v0.1.3 patch adds a client-only integrity check before a
session-stored receipt artifact can render the verified receipt view. It
validates the artifact schema and recomputes the existing deterministic receipt
ID over the displayed fields. This does not replace or modify
`verifyDepositReceipt`; independent public receipt lookup and event binding
remain authoritative. Browser storage remains client-controlled under the
documented compromised-frontend residual risk.

The patch also adds focused receipt mutation, mobile overflow, explorer-link,
and keyboard-focus E2E coverage and updates deployment and submission
documentation. It changes no engine, policy, API, indexer, database, guard,
wallet adapter, or transaction semantics. `v0.1.2` remains immutable.

## v0.1.2 presentation patch review

The v0.1.2 release changes only the signing workflow and receipt presentation
surfaces in `apps/web/app/_components/signing-workflow.tsx`,
`apps/web/app/_components/receipt-view.tsx`, and `apps/web/app/globals.css`, plus
release metadata and judge-facing documentation. The audit found no change to
the engine, policies, API, indexer, database, guard validation, receipt
verification, wallet adapter, or transaction semantics.

| Area | Result | Evidence |
|---|---|---|
| Wallet execution boundary | PASS | Existing wallet callbacks and call counts are unchanged; the release UI only presents simulation and confirmation state. |
| Security/API behavior | PASS | No server, API, guard, indexer, database, or dependency source file is in the UI patch. |
| Evidence hierarchy | PASS | Snapshot, freshness, model, policy, signal, recommendation, and exact-action details remain available through the UI. |
| Receipt presentation | PASS | Verified public receipt state, receipt ID copy, and explorer navigation are presentation additions; verification logic is unchanged. |
| Responsive/accessibility behavior | PASS | Desktop and 390px fixture checks pass; keyboard focus and reduced-motion checks pass. |
| Repository hygiene | PASS | No secrets, local paths, generated artifacts, databases, profiles, or screenshots are tracked. |

The latest real-wallet evidence remains the v0.1.1 non-submitting Ready X
simulation. The v0.1.2 production browser smoke used a simulation-only Wallet
Standard harness and reached `READY_FOR_CONFIRMATION` with `connectCalls=1`,
`prepareCalls=1`, and `invokeCalls=0`; it introduced no wallet confirmation,
transaction hash, or submission.

## v0.1.1 patch verification

The patch corrects a browser-only clock-offset lifetime defect that could make
a delayed final preflight fail with `INVALID_INTENT`. The offset is memoized per
bootstrap response rather than recalculated on every React render. A delayed
E2E regression and a fresh Ready X `5.33.8` / Wallet API `0.10.3` mainnet run
both reached `READY_FOR_CONFIRMATION`. Only
`wallet_strk20PrepareInvoke(..., simulate: true)` was observed; no invoke,
broadcast, transaction hash, or transaction submission occurred.

Any unresolved external blocker must be reported rather than replaced with
fabricated browser, deployment, or registry evidence.

The detailed final adversarial matrix is in
[FINAL_SECURITY_REVIEW.md](FINAL_SECURITY_REVIEW.md). It records implemented
controls separately from residual risks such as colluding RPC providers,
compromised browser or wallet software, and telemetry outside the published
passive-public-observer threat model.
