# Cutout v0.2 audit notes

Audit date: 2026-08-20

This is the required pre-implementation record for the v0.2 sprint. Findings are based on the current repository, direct production HTTP checks, and read-only inspection of the production host. No wallet transaction was requested or submitted during this audit.

## Operational recheck: 2026-08-21

- Branch: `main` at `636e81d` (`fix: keep fresh snapshots available during sync`), matching `origin/main` at the start of this continuation.
- Latest immutable release remains `v0.1.4` at `315f61a1a55fa771337eb633ecd564b2097aee1a`.
- The CUTOUT-v1.4 depth candidate is local and uncommitted. Its reviewed scope is public Withdrawal ingestion, typed withdraw preflight, S7, and deterministic WAIT support; CUTOUT-v1.3 remains separately evaluatable.
- `GET https://cutout.rouma.online/` returned HTTP `200` and rendered an available signing instrument at 2026-08-21 22:11:35 UTC.
- `GET https://cutout.rouma.online/api/preflight` returned HTTP `405`, preserving the POST-only analysis boundary.
- `GET https://cutout.rouma.online/api/health` returned HTTP `200` at 2026-08-21 22:08:38 UTC.
- Health reported `ready=true`, API `HEALTHY`, database `HEALTHY`, and snapshot `CURRENT_COMPLETE_SNAPSHOT` at block `13,659,840`, hash `0x232db38d277562ae1c62afbee514e3c74ffb4538d19ed0f6ceb655d3ace4caac`.
- Source age was `27s` and index lag was `7s`, both inside `FRESHNESS_POLICY-v1`; both configured RPC providers were healthy.
- The indexer was transiently `SYNCING`/`DEGRADED` after `RPC_UNAVAILABLE`, while the last complete snapshot remained active and current. This is the intended availability fix: ordinary catch-up or a transient provider failure does not withdraw still-valid evidence; reorg, schema, corruption, or expired freshness still fails closed.
- Production continues to report `CUTOUT-v1.3`; CUTOUT-v1.4 has not been committed, deployed, or presented as live.

## Operational recheck: 2026-08-22

- Live root returned HTTP `200` with an available signing instrument.
- `GET /api/health` returned HTTP `200`, `HEALTHY`, `ready: true`, and
  `CURRENT_COMPLETE_SNAPSHOT` at block `13,662,900`, hash
  `0x04becf67908370bfe524cf82d88e92dd433dd910dc35a7f3ae3daf299373f1b4`.
- Source age was `24s` and index lag was `0s`; both configured RPC providers
  agreed at the same head and active-path database integrity was `ok`.
- The indexer had recovered from a transient `RPC_UNAVAILABLE` and was
  `COMPLETE` at the final check. This confirms the availability fix without
  changing the deployed model or policies.
- `GET /api/preflight` returned HTTP `405`, preserving the POST-only boundary.

This live sample is production v0.1.4 / CUTOUT-v1.3 evidence. The local v1.4
candidate remains uncommitted, undeployed, and separately labeled.

### Current candidate disposition

- Resolved in the candidate: bounded snapshot retention, cheap request-time health integrity reporting, retention of a still-current complete snapshot during routine catch-up/transient RPC failure, localhost-only port `3000`, neutral proposal defaults, five-stage flow copy, withdrawal ingestion/analysis, S7, deterministic `WAIT`, a wallet-free cover ledger, amount ladder, package evidence surface, and Lenis/GSAP lag-smoothing and interaction exclusions.
- Model/database identity is now explicit. Schema version `4` persists `indexer_state.model_version`; a writable v1.3-to-v1.4 transition clears observations, blocks, batches, snapshots, and cursor state before replay. A read-only mismatch fails closed with `MODEL_VERSION_MISMATCH`.
- Remaining review: the workflow file remains large (1,240 lines) and should
  be decomposed in a later maintainability pass if the candidate becomes a
  release. Documentation is being brought into candidate/production alignment
  now. No P0/P1 availability or wallet-boundary blocker remains in the current
  candidate.

### Candidate disposition update

- P0 snapshot retention, request-time health integrity, and routine sync
  availability are fixed in the candidate. The active snapshot is retained
  through ordinary catch-up and transient RPC failure while freshness remains
  valid; unsafe recovery still withdraws it.
- P1 localhost-only application binding, typed Withdrawal ingestion, named
  v1.4 model identity/replay isolation, wallet-free cover evidence, amount
  defaults/ladder, evidence-only package surface, and Lenis/GSAP interaction
  handling are implemented and covered by tests.
- P2 flow-rail clarity and reduced-motion behavior are implemented. The trust
  marquee remains a residual presentation concern and is not a release blocker.
- The live production deployment remains v0.1.4/v1.3. `strk20.json` stays
  unchanged because the v1.4 candidate is not deployed.

## Current tree and release facts

- Branch: `main`
- Current `main` commit: `636e81d1686e701c6c9e10f9c192289979e1ebbe` (`fix: keep fresh snapshots available during sync`), matching `origin/main` before the local candidate changes
- Latest immutable release tag: `v0.1.4` at `315f61a1a55fa771337eb633ecd564b2097aee1a`
- Package metadata: root and `@cutout/guard` are `0.1.4`
- Runtime: Node `>=22.5 <23`, Next.js `16.3.1`, Starknet.js `10.4.0`
- Motion: Lenis `1.3.26`, GSAP `3.15.0`, and `@gsap/react` `2.1.2` are already integrated. The provider owns Lenis/GSAP ticker synchronization and ScrollTrigger updates; the workflow has intro, section, rail, state-panel, and receipt reveals.
- Frozen analysis path: `CUTOUT-v1.3`, `GUARD_POLICY-v1`, and `FRESHNESS_POLICY-v1`
- Released/production transaction intent: one typed STRK20 shield/deposit. The local CUTOUT-v1.4 candidate additionally analyzes a typed withdrawal, but intentionally exposes no withdrawal wallet invocation path. Private transfer, swap, mixed actions, and arbitrary calldata still fail closed.
- Released/production public observations: `Deposit` plus the public fact of `ViewingKeySet`. The local candidate adds the public `Withdrawal` edge. Encrypted viewing-key payloads are never retained.
- Wallet boundary: the browser performs final exact preflight, simulation through `strk20PrepareInvoke(..., true)`, explicit approval, and wallet-owned submission. The package and backend do not export submission authority.
- Receipt boundary: success requires independent public inclusion plus exactly one reviewed STRK20 `Deposit` event bound to pool, account, token, and amount. The browser also recomputes the receipt ID before rendering verified evidence.

## Engineering summary of the implementation specs

- `S1` detects an exact `(token, amount)` that has no prior occurrence in the 30-day observation window before the proposed action.
- `S2` is exact-amount reconciliation against the counterpart public edge. It is not applicable to a future deposit in v1.3.
- `S3` is deposit-to-withdraw proximity at or below 3,600 seconds. It is not applicable to shield preflight in v1.3.
- `S4` detects a public `ViewingKeySet`/channel-open observation for the same account in the preceding 1,800 seconds.
- `S5` fires when the trailing 24-hour exact-amount candidate cohort is at most five or fails address diversity, top-address concentration, active-day durability, or burst-concentration checks.
- User flexibility is an authorization bound, not a search hint. Any accepted recommendation becomes a new exact intent and receives another preflight before wallet simulation.
- Freshness is fail-closed at a maximum source age of 120 seconds and maximum index lag of 120 seconds.
- `LOW`, `MEDIUM`, and `HIGH` map to `ALLOW`, `WARN`, and `DENY`; none is a privacy guarantee.

## Production evidence

Production URL: `https://cutout.rouma.online`

Direct checks during this audit:

- `GET /api/preflight`: HTTP `405`, as expected for the POST-only interface.
- `GET /api/health`: HTTP `503` after `44.33s`.
- Reported health: `DEGRADED`, `ready=false`, indexer `SYNCING`.
- Snapshot: `STALE_SNAPSHOT`, reason `RPC_HEAD_INCONSISTENT`, block `13,600,261`, hash `0x78e4405b68903867ffac05af609c9a14df03f31b9ec746f75053ccc0e38971ad`.
- The response reported source age `-18s` and index lag `7s`. The negative source age is an application timing defect: health captured `now` before a long integrity scan, then read a newer snapshot.
- Both RPC providers were healthy and agreed at block `13,600,260`; the current-head cross-check had advanced to block `13,600,265` while health was blocked.
- Database path in both containers: `/var/lib/cutout/cutout.sqlite` on the shared `cutout_cutout-data` volume.
- API connection: SQLite `readOnly=true` and `PRAGMA query_only=ON`.
- Indexer: one long-lived writer, interval `15s`, bounded RPC backoff, zero container restarts.
- Container boundary: `user=node`, `cap_drop=ALL`, and `no-new-privileges=true` for API and indexer.
- Caddy is active. HTTP redirects to HTTPS. External probes to port `3000` time out, but Compose still publishes it on all host interfaces.

Database evidence from the production volume:

- SQLite file size: about `4.5 GB`; volume usage is about `13 GB` including backups.
- `snapshots`: `6,168` rows.
- Total duplicated `canonical_json` in `snapshots`: `4,703,627,406` bytes.
- Largest snapshot JSON: `783,080` bytes.
- Public events: `874`; canonical blocks: `101,836`; ingestion batches: `6,559`.
- A snapshot-count/size query took about `25.8s`; the authoritative health request took about `44.3s` because it runs `PRAGMA quick_check` over the entire database.

## Prioritized findings

### P0

1. **Unbounded full-snapshot retention grows the database continuously.**
   - Location: `src/indexer/store.ts:846`, `src/indexer/store.ts:850`, `src/indexer/store.ts:861`
   - Evidence: every successful 15-second sync inserts another full canonical JSON snapshot and no normal-path pruning exists. Production has 6,168 snapshots totaling 4.70 GB while the live public-event set has 874 rows.
   - Judge impact: disk and read latency grow continuously; health and page availability degrade during the demo.
   - Fix: retain the active snapshot plus a small bounded history needed for rollback/operations, delete older rows atomically after activation, and test retention/rollback behavior.

2. **Health performs a synchronous full-database integrity scan on every request and evaluates with a stale clock.**
   - Location: `apps/web/app/api/health/route.ts:17`, `src/operations/health.ts:149`, `src/operations/health.ts:160`, `src/indexer/store.ts:955`
   - Evidence: `/api/health` took 44.33 seconds. `now` is captured before `PRAGMA quick_check`; a newer snapshot can be written during the scan, producing a negative source age and false `RPC_HEAD_INCONSISTENT`.
   - Judge impact: readiness is slow and commonly false even while RPC and indexing are healthy; Caddy/root requests can stall behind disk pressure.
   - Fix: move deep integrity verification to a bounded operator/indexer task, expose a timestamped persisted result, keep request-time health checks cheap, and capture evaluation time after blocking work.

3. **Routine forward synchronization withdraws a still-current snapshot and transient RPC errors invalidate it immediately.**
   - Location: `src/indexer/indexer.ts:504`, `src/indexer/store.ts:635`, `src/indexer/store.ts:655`, `src/indexer/indexer.ts:594`, `src/operations/indexer-supervisor.ts:103`
   - Evidence: every attempt sets `SYNCING`; every committed batch sets `active_snapshot_hash=NULL`; any RPC selection/sync error sets `ERROR`. Logs show frequent short `RPC_UNAVAILABLE` failures between successful syncs.
   - Judge impact: the demo spends substantial time on `SNAPSHOT_UNAVAILABLE` even though a complete snapshot remains inside the 120-second policy.
   - Fix: keep the last complete snapshot active through ordinary forward catch-up and transient provider failures, withdraw it only when reorg/schema/corruption uncertainty exists or freshness expires, and prove stale data still cannot produce `ALLOW`.

### P1

4. **The application entry is all-or-nothing on bootstrap availability.**
   - Location: `apps/web/lib/server-runtime.ts:41`, `apps/web/app/page.tsx:7`, `apps/web/app/_components/signing-workflow.tsx:477`
   - Impact: a transient missing active snapshot replaces the entire product with a wall, so judges cannot inspect the workflow, historical proof, or a clearly stale cover view.
   - Fix: keep signing disabled, but render the instrument with explicit current/stale/unavailable provenance and last-good public evidence where available.

5. **The production Compose file publishes port 3000 on every host interface.**
   - Location: `compose.yaml:28`
   - Impact: AWS filtering currently prevents external access, but defense in depth depends on an external security-group rule rather than the deployment manifest.
   - Fix: bind `127.0.0.1:3000:3000` for Caddy-only access and verify the reverse proxy path.

6. **The indexed public schema omits `Withdrawal`, the busier STRK20 edge.**
   - Location: `src/indexer/store.ts:300`, `src/starknet/types.ts:44`, `src/starknet/freshness.ts:229`
   - Impact: Cutout does not use the 38,223-withdrawal public surface and cannot score the classic unshield linkage path, limiting the 30% integration-depth score.
   - Fix: review the deployed ABI, add a typed normalized withdrawal observation, include its selector in completeness/hash validation, and preserve payload minimization.

7. **CUTOUT-v1.3 exposes action names but only evaluates shield; S2/S3 are dead on the live path.**
   - Location: `src/engine/types.ts:4`, `src/engine/types.ts:20`, `src/engine/evaluate.ts:205`, `src/engine/evaluate.ts:242`
   - Impact: the type surface suggests depth that the evaluator does not provide.
   - Fix: keep v1.3 replay unchanged and introduce a named `CUTOUT-v1.4` evaluator with typed withdraw semantics and action-specific S2/S3 applicability.

8. **There is no wallet-free live cover surface.**
   - Location: `apps/web/app/page.tsx:7`, `apps/web/app/_components/signing-workflow.tsx:214`
   - Impact: a judge cannot see the exact-amount cohort thesis or STRK20 event depth without connecting a wallet and entering the signing flow.
   - Fix: add a read-only `/cover` surface sourced from the same canonical snapshot and fail closed or clearly label last-good data as stale.

9. **The proposal defaults to a hard-coded arbitrary amount and range.**
   - Location: `apps/web/app/_components/signing-workflow.tsx:236`
   - Impact: `4713.22` / `4600..4800` looks like a magic recommendation and can itself be a fingerprint; it is disconnected from current public cohorts.
   - Fix: start neutral and offer a live, user-initiated amount ladder derived from healthy current cohorts.

10. **The integrator package is headless TypeScript only, not an installable UI decision surface.**
    - Location: `src/guard-package.ts:1`, `examples/guard-consumer/index.ts:1`, `packages/guard/test/public-api.test.mjs:6`
    - Impact: IDEA-26 is only partially occupied; another STRK20 app cannot drop in the evidence experience.
    - Fix: add a narrow React hook and evidence panel without Next.js or wallet-submit imports, then extend package export tests and the isolated consumer.

11. **Lenis/GSAP integration lacks the documented lag-smoothing handoff and interaction exclusions.**
    - Location: `apps/web/app/_components/motion-provider.tsx:27`, `apps/web/app/_components/signing-workflow.tsx:567`, `apps/web/app/_components/signing-workflow.tsx:629`
    - Impact: GSAP ticker catch-up can desynchronize smooth scrolling; inputs and disclosures can fight Lenis wheel handling.
    - Fix: set `gsap.ticker.lagSmoothing(0)` while Lenis owns RAF and add `data-lenis-prevent` to inputs, disclosures, copy controls, and any inner-scrolling cover table.

12. **Unavailable-state recovery uses full page reloads and exposes no last-good context.**
    - Location: `apps/web/app/_components/signing-workflow.tsx:489`, `apps/web/app/_components/signing-workflow.tsx:598`, `apps/web/app/_components/signing-workflow.tsx:648`
    - Impact: repeated reloads can amplify the expensive bootstrap/health path and the user cannot tell whether recovery is progressing.
    - Fix: add an in-place bootstrap/health retry with loading state, last-good block/hash, and no signing controls until current evidence returns.

### P2

13. **The flow rail compresses simulation and wallet authority into one `Sign` step.**
    - Location: `apps/web/app/_components/signing-workflow.tsx:151`
    - Impact: the most important security distinction is less explicit than the actual state machine.
    - Fix: show `Propose -> Verify -> Review -> Simulate -> User wallet`, preserving the same execution semantics.

14. **The continuously scrolling trust marquee reads as promotional decoration.**
    - Location: `apps/web/app/_components/signing-workflow.tsx:688`, `apps/web/app/globals.css:1095`
    - Impact: constant motion dilutes the quiet signing-instrument language and competes with state changes.
    - Fix: replace it with a static authority/boundary strip or remove it during the focused UI phase.

15. **Release/demo identity is ambiguous on `main`, and submission metadata remains intentionally incomplete.**
    - Location: `package.json:3`, `strk20.json:9`
    - Evidence: `main` includes a post-v0.1.4 UI commit while package metadata remains 0.1.4; `demo_url` is empty.
    - Impact: judges and integrators can confuse the immutable tag with later unreleased work. An empty demo URL also reduces submission readiness.
    - Fix: keep v0.1.4 immutable, version the completed v0.2 release explicitly, and set `demo_url` only after production reliably serves current evidence.

## Positive findings to preserve

- Amount parsing and formatting use `bigint`; selected values and recommendation bounds are revalidated at the Starknet and workflow seams.
- Unsupported/mixed actions and arbitrary calldata fail closed.
- Final exact preflight, matching simulation evidence, explicit approval, and warning acknowledgement are all required before the isolated browser submission adapter can invoke the wallet.
- The backend, package, indexer, and receipt verifier do not export a signing path.
- Stale, corrupt, partial, reorged, wrong-chain, wrong-pool, and schema-mismatched snapshots have deterministic failure tests.
- Receipt verification binds public inclusion and exactly one reviewed event, and the receipt page rejects an artifact whose ID no longer matches its content.
- Production uses one persistent SQLite volume, one writer, a read-only/query-only API connection, non-root containers, dropped capabilities, and `no-new-privileges`.
- Reduced-motion and narrow-viewport Playwright coverage already exists and wallet fixtures assert zero invoke calls in non-submitting paths.

## Do not touch without a versioned, reviewed change

- Ready X / WalletAccountV6 remains the only signing and submission authority.
- Final exact preflight, matching simulation, explicit user approval, and warning acknowledgement cannot be bypassed.
- `CUTOUT-v1.3` constants, outputs, and golden replay remain available bit-for-bit.
- `GUARD_POLICY-v1` and `FRESHNESS_POLICY-v1` remain frozen.
- Snapshot canonicalization and hash binding remain deterministic.
- Receipt verification remains independent of the signing wallet and bound to pool, account, token, amount, event, block, and receipt ID.
- S6 remains post-execution conservation-of-value only and does not enter a preflight band.
- No private key, seed phrase, viewing-key payload, note, proof, private balance, or arbitrary calldata enters Cutout.

## STRK20 integration-depth gaps

- No `Withdrawal` ingestion, typed intent, S2/S3 evidence, simulation boundary, or receipt artifact.
- No live per-token exact-amount cover map from the canonical snapshot.
- No live unmatched-amount statistic or healthy-cover amount ladder.
- No S7 round/unique-decimal fingerprint.
- No deterministic `WAIT` recommendation.
- ViewingKeySet is used only for account-proximity S4; pool-level public registration density is not surfaced.
- `@cutout/guard` has no React hook/evidence panel for another STRK20 application.
- AVNU has not been reviewed for an honest public exact-amount edge; no score should be invented.

## Explicit non-goals

- No Cutout signer, relayer, router contract, mixer, delayed executor, or autonomous transaction system.
- No note indexing, viewing-key custody, proof generation, private-balance access, or payload ingestion.
- No AI risk engine, chatbot, calibrated privacy probability, or anonymity-set claim.
- No arbitrary action/calldata support, generic DeFi dashboard, DEX, bridge, payroll, poker, or unrelated hackathon feature.
- No policy-threshold relaxation to make production appear healthy.
- No new mainnet transaction without explicit human authorization.
