# Cutout v0.2 audit notes

Audit date: 2026-08-20

This is the required pre-implementation record for the v0.2 sprint. Findings are based on the current repository, direct production HTTP checks, and read-only inspection of the production host. No wallet transaction was requested or submitted during this audit.

## Release and deployment completion: 2026-08-23

- Branch `main` and `origin/main` both resolved to
  `3bba285fa52bbe01cbaa676337b0111c3e2ef180` at the start of this evidence
  update.
- The immutable `v0.2.0` tag resolves to release commit
  `f34655b7b2f19b47b7fcdeec832fce39a455a6a7`; its annotated tag object is
  `e7de0eb860ecf3ed027a7299471275b34db7c063`.
- Production runs the reviewed post-release recovery commit `3bba285`, and the
  GitHub release remains `https://github.com/dmetagame/cutout/releases/tag/v0.2.0`.
- GitHub Actions passed for the deployed commit:
  `https://github.com/dmetagame/cutout/actions/runs/32633508257`.
- At `2026-08-23T11:08:49Z`, health returned HTTP `200`, `HEALTHY`,
  `ready: true`, and `CURRENT_COMPLETE_SNAPSHOT` at block `13,738,142`, hash
  `0x6aa680d9e86bd5b4e774c72d4e1e6a2f38d0e0e900dc8afe8e3a449143b308f1`.
- Source age was `26s` at health and `25s` at the matched preflight; index lag
  was `10s`. Exact `0.01 STRK` returned `AVAILABLE / ALLOW / LOW`, decision ID
  `0xdf9db0ae15423ea211bf8d46ded65ae7526cdcd991053a181d51ca188b0df745`.
- Production reports `CUTOUT-v1.4`, `GUARD_POLICY-v1`, and
  `FRESHNESS_POLICY-v1`. CUTOUT-v1.3 remains available for fixture replay.
- Browser checks passed at 1440, 1024, 768, 430, and 390px plus reduced motion
  and historical receipt states, with no overflow, console errors, page errors,
  or failed requests.
- The simulation-only wallet fixture reached `READY_FOR_CONFIRMATION` with
  `connectCalls=1`, `prepareCalls=1`, and `invokeCalls=0`. It produced no hash,
  confirmation, broadcast, or submitted transaction.
- The browser smoke encountered a real canonical-snapshot advance. The UI
  cleared the superseded result, exposed no decision, required an explicit
  refresh, and ran a fresh preflight before recovering. No uncertain snapshot
  produced `ALLOW`.
- Production retains one persistent SQLite volume, one indexer writer, a
  read-only/query-only API, localhost-only port `3000`, unprivileged containers,
  `CapDrop=ALL`, and `no-new-privileges`. The deployed containers had zero
  restarts at verification.

## Historical operational rechecks

The 2026-08-21 and 2026-08-22 samples below record the pre-v0.2.0 production
state. They are retained as chronology, not as current deployment claims.

- On 2026-08-21, production v0.1.4 returned HTTP `200` with a
  `CURRENT_COMPLETE_SNAPSHOT` at block `13,659,840`, source age `27s`, and index
  lag `7s`. A transient `RPC_UNAVAILABLE` left the still-current complete
  snapshot active while routine synchronization recovered.
- On 2026-08-22, production v0.1.4 again returned HTTP `200`, `HEALTHY`, and a
  complete snapshot at block `13,662,900`, source age `24s`, and index lag `0s`.
  `GET /api/preflight` returned HTTP `405`, preserving the POST-only boundary.

## Release disposition

- The P0 snapshot-retention, request-time health, and routine synchronization
  availability findings are fixed and deployed. Unsafe recovery, corruption,
  model mismatch, reorg uncertainty, and expired freshness remain fail-closed.
- The P1 localhost binding, typed Withdrawal analysis, named CUTOUT-v1.4 model
  identity, replay isolation, cover evidence, neutral amount entry and ladder,
  evidence-only package surface, and Lenis/GSAP interaction handling are
  released and covered by tests.
- Schema version `4` persists `indexer_state.model_version`. A writable
  v1.3-to-v1.4 transition clears incompatible read-model state before replay;
  a read-only mismatch fails closed with `MODEL_VERSION_MISMATCH`.
- The five-stage flow and reduced-motion behavior are released. The large
  workflow component remains a later maintainability opportunity, not a
  security or submission blocker.

## Current tree and release facts

- Branch: `main`
- Current deployed `main` commit: `3bba285fa52bbe01cbaa676337b0111c3e2ef180` (`fix: recover from snapshot advances during preflight`)
- Latest immutable release tag: `v0.2.0` at release commit `f34655b7b2f19b47b7fcdeec832fce39a455a6a7`
- Package metadata: root and `@cutout/guard` are `0.2.0`
- Runtime: Node `>=22.5 <23`, Next.js `16.3.1`, Starknet.js `10.4.0`
- Motion: Lenis `1.3.26`, GSAP `3.15.0`, and `@gsap/react` `2.1.2` are already integrated. The provider owns Lenis/GSAP ticker synchronization and ScrollTrigger updates; the workflow has intro, section, rail, state-panel, and receipt reveals.
- Analysis identity: production uses `CUTOUT-v1.4`; frozen CUTOUT-v1.3 replay remains available. `GUARD_POLICY-v1` and `FRESHNESS_POLICY-v1` remain frozen.
- Production transaction intent remains one typed STRK20 shield/deposit. CUTOUT-v1.4 additionally analyzes a typed withdrawal but intentionally exposes no withdrawal wallet invocation path. Private transfer, swap, mixed actions, and arbitrary calldata still fail closed.
- Production public observations are `Deposit`, `Withdrawal`, and the public fact of `ViewingKeySet`. Encrypted viewing-key payloads are never retained.
- Wallet boundary: the browser performs final exact preflight, simulation through `strk20PrepareInvoke(..., true)`, explicit approval, and wallet-owned submission. The package and backend do not export submission authority.
- Receipt boundary: success requires independent public inclusion plus exactly one reviewed STRK20 `Deposit` event bound to pool, account, token, and amount. The browser also recomputes the receipt ID before rendering verified evidence.

## Engineering summary of the implementation specs

- `S1` detects an exact `(token, amount)` that has no prior occurrence in the 30-day observation window before the proposed action.
- `S2` is exact-amount reconciliation against the counterpart public edge. It is applicable to typed withdrawal analysis in v1.4 and remains not applicable to a future deposit or v1.3 shield replay.
- `S3` is deposit-to-withdraw proximity at or below 3,600 seconds. It is applicable to typed withdrawal analysis in v1.4 and remains not applicable to shield preflight.
- `S4` detects a public `ViewingKeySet`/channel-open observation for the same account in the preceding 1,800 seconds.
- `S5` fires when the trailing 24-hour exact-amount candidate cohort is at most five or fails address diversity, top-address concentration, active-day durability, or burst-concentration checks.
- `S7` identifies round or unusually precise public amount fingerprints in the named v1.4 model; it does not replace cohort evidence.
- User flexibility is an authorization bound, not a search hint. Any accepted recommendation becomes a new exact intent and receives another preflight before wallet simulation.
- A v1.4 `WAIT` recommendation is evidence-only bounded advice. It schedules nothing and creates no signing or submission authority.
- Freshness is fail-closed at a maximum source age of 120 seconds and maximum index lag of 120 seconds.
- `LOW`, `MEDIUM`, and `HIGH` map to `ALLOW`, `WARN`, and `DENY`; none is a privacy guarantee.

## Initial production evidence before fixes

Production URL: `https://cutout.rouma.online`

Direct checks during the initial audit:

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

## Prioritized findings from the initial audit

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

## STRK20 integration-depth disposition

- Resolved in v0.2.0: public Withdrawal ingestion, typed withdrawal analysis,
  withdrawal-only S2/S3 evidence, per-token cover maps, unmatched-amount
  context, a healthy-cover amount ladder, S7, deterministic `WAIT`, and the
  evidence-only React package surface.
- Intentionally unchanged: withdrawal remains analysis-only. There is no
  withdrawal wallet simulation, invocation, submission, or receipt artifact.
  Deposit remains the only executable wallet path.
- Remaining non-blocking depth limits: `ViewingKeySet` is used for
  account-proximity S4 rather than a pool-level registration-density score, and
  AVNU has no score because no reviewed honest public exact-amount edge has
  been established.

## Explicit non-goals

- No Cutout signer, relayer, router contract, mixer, delayed executor, or autonomous transaction system.
- No note indexing, viewing-key custody, proof generation, private-balance access, or payload ingestion.
- No AI risk engine, chatbot, calibrated privacy probability, or anonymity-set claim.
- No arbitrary action/calldata support, generic DeFi dashboard, DEX, bridge, payroll, poker, or unrelated hackathon feature.
- No policy-threshold relaxation to make production appear healthy.
- No new mainnet transaction without explicit human authorization.
