# Cutout v0.2 — Audit, fix, depth, GSAP/Lenis polish

You are Codex working inside the existing repo **https://github.com/dmetagame/cutout** (this working tree). Cutout is a live STRK20 Private Sprint project.

- Hackathon: https://strk20.starknet.io/hackathon
- Applications opened 14 Aug 2026. Submissions close **31 Aug 2026, 23:59 UTC**. Winners 4 Sep.
- Prize: $5,000 USD in STRK ($2,500 / $1,500 / $1,000)
- Live app: https://cutout.rouma.online/
- Current tag: **v0.1.4** (presentation-only patch: Lenis 1.3.26 + GSAP 3.15.0). Engine, policies, indexer, wallet boundary unchanged.

Do **not** scaffold a new app. Do **not** rewrite the architecture. Work in this repository. Read `AGENTS.md` first; it is the law.

Judges score, in order of what this sprint must optimize:

| Criterion | Weight | What it actually rewards |
|---|---|---|
| STRK20 integration depth | 30% | How far into the stack: public Deposit + Withdrawal + ViewingKeySet events, Wallet API (`strk20PrepareInvoke` / `strk20InvokeTransaction`), WalletAccountV6, receipts. Not a random Cairo contract. Occupy IDEA-25 *and* IDEA-26. |
| Working mainnet product | 30% | It runs, on mainnet, for a real user. A demo that opens on `SNAPSHOT_UNAVAILABLE` scores ~0 here. |
| Innovation | 25% | Exact-amount public-cover routing at signing time. Deepen that. Do not dilute it into a mixer, DEX, or chatbot. |
| Docs / OSS quality | 15% | README someone can follow, frozen specs that match code, Apache-2.0, a 90-second demo path. |

---

## 0. Skills protocol (non-negotiable)

This prompt is the mission. Skills are the method. Do not invent a parallel process.

### 0.1 Inventory

At session start, search:

```text
/skills
.agents/skills/**/SKILL.md
.codex/skills/**/SKILL.md
~/.agents/skills/**/SKILL.md
~/.codex/skills/**/SKILL.md
AGENTS.md / CLAUDE.md
skills/**/SKILL.md
```

Print a table: `skill name → path → phase you will use it in`.

### 0.2 Load per phase

Open the matching `SKILL.md` **before** that phase. Quote the skill name in the phase header. Invoke with `$skill-name`. Progressive disclosure: load only the `references/` that skill points at. If the skill has `scripts/`, run or patch those.

If no matching skill exists, say so in one line and continue with the inlined checklist. Never skip a *present* skill because this prompt is long.

If `$skill-installer` exists and a high-value skill is missing, you **may** install it, but do not stall the sprint waiting for a restart. Follow the inlined bar immediately.

Suggested mapping (match by description; names vary):

| Phase | Load a skill that covers |
|---|---|
| 0 recon | `$create-plan` / `$define-goal` / repo exploration |
| 1 audit | `$security-threat-model` `$security-best-practices` `$security-ownership-map` `$security-review` `$code-review` |
| 2–3 fixes | debugger / verification / `$playwright` |
| 4 depth | `$api-design` if present, then security-threat-model **again** on the new surface |
| 5 motion | `$frontend-design` / `$frontend-skill` / a11y. Kill generic AI UI. |
| 6 wrap | `$playwright` `$screenshot` technical-writing. `$gh-fix-ci` if CI is red. `$yeet` only if the user asked you to open a PR. |

If a planning skill exists, run it **once** after recon and before writing code. Short plan, then execute.

---

## 1. What Cutout is (do not drift)

Cutout is a **wallet-native signing guard** for STRK20.

Before a user signs, it checks whether the proposed **token + exact amount** has meaningful **public cohort cover**. If the user explicitly allowed amount flexibility, it can recommend the smallest in-bounds amount change that reaches a healthier public cohort.

```text
typed shield intent
  → canonical public STRK20 snapshot
  → deterministic CUTOUT-v1.3 evaluation
  → GUARD_POLICY-v1 decision
  → optional in-bounds amount recommendation
  → final exact-amount preflight
  → wallet simulation
  → explicit user confirmation
  → wallet-owned submission
  → independent public receipt verification
```

Architecture planes (keep them separate):

- Observation: Starknet RPC → indexer → SQLite → hashable PublicSnapshot
- Analysis: `POST /api/preflight` → CUTOUT engine → GUARD_POLICY
- Execution: Next.js client → Ready X / WalletAccountV6 → independent receipt verify

Frozen model today (`src/engine/constants.ts`):

```ts
CUTOUT-v1.3
observationSeconds  30d
cohortSeconds       24h
proximitySeconds    3600
channelSeconds      1800
thinCohort          5
minAddresses        3
maxTopShare         0.5
maxBurstShare       0.6
minActiveDays       7
amountTolerance     0n
```

`src/engine/types.ts` already lists `Action = "shield" | "private_transfer" | "withdraw" | "swap"` but only `action: "shield"` is a supported intent. Everything else is `UnsupportedIntent` → fail closed. Signals on the wire are only `S1 | S2 | S3 | S4 | S5`. Recommendations are only `CHANGE_AMOUNT | NO_SAFER_EXECUTION`.

Known census (`docs/CENSUS.md`, block 13,277,427, 2026-08-14):

- 15,667 deposits vs **38,223 withdrawals** (2.4×)
- Tokens with traffic: STRK 8,157 · USDC 5,922 · strkBTC 1,231 · ETH 151
- Median prior exact-amount deposits in trailing 24h: **3**
- **35%** of proposed shields had **zero** prior exact match
- Lifetime-popular amounts can be 95–100% burst (airdrop spikes are not standing cover). Durable cover examples: 4 STRK, 1 USDC.

That census is the product. Depth means making it **live, withdraw-aware, and installable**.

Historical mainnet proof (Milestone 3 — do not resubmit unless the user authorizes a new tx):

- 0.01 STRK deposit `0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e`
- block `13427531`, snapshot `0xbe131fcf5f63309e40b8e3656465e56bac7f5b8a1b8d5336974071bfabc34acf`

v0.1.1 separately reached `READY_FOR_CONFIRMATION` via `wallet_strk20PrepareInvoke(..., simulate: true)` against snapshot `0x494e624c…` at block `13,448,562`. No confirmation occurred.

---

## 2. Current production facts (verify, then treat as P0 if still true)

Verified 2026-08-20, re-verify at session start:

- https://cutout.rouma.online/ renders the fail-closed wall: `Unavailable Starknet Mainnet` / `SNAPSHOT_UNAVAILABLE` / “No complete canonical snapshot is available.” / “Refresh snapshot”.
- `GET https://cutout.rouma.online/api/health` → **HTTP 503**.
- `strk20.json` has `"demo_url": ""` and `"demo_video": ""`.
- Repo has **no** `AGENTS.md` on `main` until you add the one from this pack.

Fail-closed is correct *behavior*. A demo that cannot leave the empty state is not a working mainnet product.

---

## 3. Hard invariants

1. **Do not give Cutout signing authority.** No backend keys. No `strk20InvokeTransaction` outside the isolated browser wallet adapter. No autonomous execution. No “sign for the user”.
2. **Fail closed.** Stale / incomplete / disagreeing / reorged / corrupt evidence → no recommendation, no wallet call, no success claim.
3. **Do not silently mutate CUTOUT-v1.3.** New signals, new actions, new recommendation kinds require **CUTOUT-v1.4** plus tests that v1.3 fixtures still replay bit-identically when the v1.3 path is selected.
4. **Do not hijack S6.** Threat model: S6 is conservation-of-value, **post-execution only**, does not enter the band, is not computed during preflight. Round-amount / unique-decimal is a **new** S7 if you add it.
5. **No LLM in the engine.** Same intent + same canonical snapshot = same decision ID.
6. **Do not claim anonymity, untraceability, unlinkability, or a deanonymization probability.** Candidate cohorts are not anonymity sets. IDEA-25’s phrase “anonymity-set size” is a trap — report candidate cohort + quality failures, never an anonymity set.
7. **Do not ingest private STRK20 state.** Public `Deposit`, `Withdrawal`, and `ViewingKeySet` *observations* only (address / token / amount / block — not payloads).
8. **Do not add a Cutout contract** unless a depth feature truly needs execution authority. Default: no contract.
9. **Do not weaken GUARD_POLICY-v1 or FRESHNESS_POLICY-v1** to make the live site look healthy. Fix the indexer/ops path. If a threshold is wrong, version the policy and document why.
10. **Presentation must not change transaction semantics.**
11. **Keep `@cutout/guard` a narrow public API.** `npm run package:verify` must still prove the package cannot sign.
12. **Node `>=22.5 <23`.** Do not bump Next 16.3.1, starknet 10.4.0, gsap 3.15.0, lenis 1.3.26, lucide-react 1.31.0 without a reason and a test.
13. **Apache-2.0.** No copyleft deps.
14. **Do not submit a new mainnet tx** unless the user types an explicit authorization. Simulation-only is the default.

---

## 4. Phase A — Recon (no feature code)

Load the planning / repo-exploration skill if you have one.

Read, in this order:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/THREAT_MODEL.md` — **signal definitions are here, not in your prior**
4. `docs/SECURITY.md` + `docs/FINAL_SECURITY_REVIEW.md`
5. `docs/GUARD_POLICY.md` + `docs/FRESHNESS_POLICY.md`
6. `docs/SIGNING_WORKFLOW.md` + `docs/PREFLIGHT_API.md` + `docs/INTEGRATOR.md`
7. `docs/INDEXER.md` + `docs/SNAPSHOT.md` + `docs/HEALTH.md` + `docs/OPERATIONS.md` + `docs/DEPLOYMENT.md`
8. `docs/CENSUS.md` + `docs/DEMO_RUNBOOK.md`
9. `submission/PITCH.md` + `submission/JUDGE_FAQ.md` + `submission/DEMO_SCRIPT.md` + `strk20.json`
10. `src/engine/{evaluate,constants,types}.ts`
11. `src/workflow/{guard,receipt,amounts}.ts`
12. `src/starknet/{wallet-execution,freshness,snapshot,actions,abi,events}.ts`
13. `src/operations/{health,indexer-supervisor,rpc-failover}.ts`
14. `src/indexer/{indexer,store}.ts`
15. `apps/web/app/{page,layout,globals.css}.tsx?`
16. `apps/web/app/_components/{signing-workflow,motion-provider,motion-system,receipt-view}.*`
17. `apps/web/lib/server-runtime.ts` (or equivalent bootstrap)
18. `packages/guard/**` + `examples/guard-consumer/**`
19. `tests/**` + `apps/web/e2e/**`
20. `compose.yaml` `Dockerfile` `.env.example` `package.json`

Then actually hit production:

- `GET https://cutout.rouma.online/`
- `GET https://cutout.rouma.online/api/health`
- `GET https://cutout.rouma.online/api/preflight` (expect method-not-allowed / fail-closed; record it)

Write `docs/AUDIT_NOTES.md` with:

- What is true about the current tree (versions, supported action, motion already present)
- Production health: HTTP status, reasonCode, indexer, lag, RPC, DB path
- Top 15 findings ranked P0/P1/P2, each with `file:line`, impact on judging, proposed fix
- A “do not touch” list (wallet boundary, frozen v1.3 replay, receipt binding, S6 meaning)
- Depth gaps vs the 30% STRK20-integration-depth criterion
- Explicit non-goals

Do not start feature work until this file exists.

---

## 5. Phase B — Proper audit

Load `$security-threat-model` + `$security-best-practices` + `$security-ownership-map` (or `$security-review` / `$code-review`). Audit as an adversarial reviewer, not as the author.

### 5A. Security / correctness

- Intent validation: only one typed action; mixed/arbitrary calldata fail closed. Today `validateSingleDepositAction` — do not broaden it into “any calldata”.
- Amount arithmetic: no floats; conversions live in `src/workflow/amounts.ts`.
- Recommendation cannot escape user bounds; selected recommendation is a **new exact intent** and is preflighted again.
- Snapshot canonicalization + hash stability.
- Reorg / schema-mismatch / RPC disagreement withdraws evidence.
- Freshness: confirm `maximumSourceAgeSeconds = 120` and `maximumIndexLagSeconds = 120` are enforced on **every** evidence-serving path, including Next.js bootstrap.
- Wallet adapter isolation: search the whole repo for `strk20InvokeTransaction`, `invoke`, `signMessage`, private-key patterns, `WalletAccount`.
- Receipt binding: account, pool, token, amount, event, snapshot hash. A tx hash alone is not success. Client-side artifact validation (v0.1.3) — mutation-rejection tests still pass.
- Telemetry: no raw account addresses or requested amounts.
- `@cutout/guard` export surface: `npm run package:verify`.
- Next.js API routes `apps/web/app/api/{preflight,health}/route.ts` vs `src/api/*` — no duplicated drifting logic.
- SQLite: single writer; web path read-only. Confirm `server-runtime` / compose actually agree with `.env.example` (`CUTOUT_DB_PATH=/var/lib/cutout/cutout.sqlite`). **Do not assume a path mismatch — prove it.**
- SSR/client split: no Node-only modules in client bundles; no secrets in `NEXT_PUBLIC_*`.
- `CUTOUT_FIXED_NOW` must be impossible in production.

### 5B. Reliability / mainnet product

Diagnose SNAPSHOT_UNAVAILABLE with evidence. Likely candidates (verify, don’t cargo-cult):

- Indexer supervisor not running as a long-lived process
- DB path mismatch between indexer, API, compose volume, Dockerfile `CMD`, and `loadWebBootstrap()`
- 120s freshness vs no continuous ingest
- RPC failover stuck (`CUTOUT_RPC_PRIMARY_URL` / `SECONDARY`)
- Container healthcheck / compose `restart` policy
- Empty DB on restart, schema mismatch, reorg loop, clock skew

`.env.example` already says both services share one persistent volume and the API is read-only. `CUTOUT_INDEX_INTERVAL_SECONDS=15`. If production is not following that, that is the bug.

### 5C. Product / engine

- S2/S3 are dead code on deposit-only. Unused STRK20 depth. Threat-model definitions already exist.
- `Action` already includes `withdraw` and `swap` in types, but they are `UnsupportedIntent`.
- ViewingKeySet is indexed but only used for S4 proximity. Pool-level registration density is unused.
- No withdraw / unshield preflight even though withdrawals are the other public edge and 2.4× more common.
- No round-amount / unique-decimal fingerprint (0.01 STRK is a lab amount and a fingerprint). If added, it is **S7**, not S6.
- No wait/delay recommendation, only `CHANGE_AMOUNT`.
- No live cover map for judges to *see* the 35% unmatched-amount problem.
- Default amount in the UI (historically `"4713.22"` or similar) must not look like a magic fingerprint. Replace with a live healthy-cohort suggestion or a clearly labeled example.
- UI state machine in `signing-workflow.tsx` — audit for unreachable states, missing retries, no disconnect, no back navigation.

### 5D. Motion / UI audit (do not polish yet)

Lenis is created in `apps/web/app/_components/motion-provider.tsx` and synced to `gsap.ticker` + `ScrollTrigger.update`. `syncTouch: false` is already set — keep it. `prevent` already honors `[data-lenis-prevent]`.

Record, then fix in Phase F:

- Is `gsap.ticker.lagSmoothing(0)` set? Lenis+GSAP desyncs without it.
- Double-rAF? Native scroll fight on iOS?
- Does `[data-lenis-prevent]` cover number inputs, `<details>`, wallet modals, copy buttons?
- `motion-system.ts` currently: intro stagger, section ScrollTrigger, rail pin at `min-width: 1024px`, active marker scale, progress line `scaleX`, `revealStatePanel`. List what is still a CSS class swap.
- Pin leakage on mobile, refresh-after-state-change, reduced-motion kill (provider sets `document.documentElement.dataset.motion`).
- Token slop in `globals.css`.
- `.trust-marquee-track` if it still exists — SaaS slop risk.

Append findings to `docs/AUDIT_NOTES.md`. Then implement.

---

## 6. Phase C — Restore working mainnet product (P0)

Load ops + `$playwright`.

The live demo cannot be an empty fail-closed screen. Preserve fail-closed *semantics*, restore *availability*.

Required:

1. Diagnose SNAPSHOT_UNAVAILABLE with evidence (health JSON, indexer status, DB path, supervisor, compose, host).
2. Make the default production path:
   - one persistent SQLite
   - supervised incremental indexer (`src/operations/indexer-supervisor.ts`)
   - read-only web/API against that same DB
   - health endpoint that tells the truth (cursor, head, lag, lastSuccessfulSync, error class — no secrets, no raw accounts/amounts)
3. Align `CUTOUT_DB_PATH`, compose volumes, Dockerfile `CMD`, and web bootstrap. Prove they agree.
4. If freshness 120s is operationally unmeetable with the current RPC, **do not secretly bump it**. Either keep 120s and make the indexer keep up, or introduce versioned `FRESHNESS_POLICY-v2` with a written rationale, still fail closed.
5. Production empty state: if evidence is genuinely unavailable, the UI is still a designed instrument (what failed, which policy, last good snapshot hash if any, retry that does not full-page-reload unless necessary). Never look crashed. A labeled **stale cover map** may still render historical census, marked STALE.
6. Operator smoke: `npm run smoke:mainnet` documented in `DEMO_RUNBOOK`. If RPC is missing in this environment, gate it; do not fake HEALTHY.
7. Fill `strk20.json` `demo_url` **only** once the demo is actually serving evidence.

Regression: when snapshot is withdrawn, API stays 503 / `NO_CONFIDENT_RECOMMENDATION` **and** UI never offers Sign.

Also fix any P0/P1 correctness bugs the audit found (amount bounds, receipt mutation, wallet-boundary leaks, hydration, broken e2e).

Tests that must stay green:

```bash
npm run check
npm run test:milestone4
npm run test:milestone5
npm run typecheck
npm run package:verify
npm run web:typecheck
npm run test:e2e
```

---

## 7. Phase D — Implementation audit fixes

Fix real bugs. Do not drive-by refactors.

Priority:

- Fail-closed holes (any path that can reach wallet invoke without final exact preflight + matching simulation + explicit approval)
- Snapshot hash / decisionId canonicalization mismatches
- Amount math
- Flexibility bounds not re-checked after recommendation
- Receipt verifier trusting wallet instead of independent public RPC
- Reorg / RPC disagreement serving a snapshot
- Clock / `evaluationTimestamp` 5s skew
- `@cutout/guard` contract tests vs actual exports
- `signing-workflow.tsx`: split only as needed (state machine, amount form, evidence panel, wallet adapter). Preserve FlowState semantics.
- Receipt ID recomputation (v0.1.3) — keep, add missing cases

Every fix: test first or with the fix. Extend `tests/engine.test.ts`, milestone tests, guard package tests, Playwright.

Load security-threat-model again after patches. No new finding may be “we’ll document it.”

---

## 8. Phase E — Cutout depth (this is how you win 30% + 25%)

Load `$api-design` if present, then `$security-threat-model` again on the new surface.

Do **not** start this until C is done, or the indexer is recovering with visible health and a labeled stale cover map.

Goal: make Cutout obviously deeper on **STRK20**, not a prettier deposit form.

Ship **CUTOUT-v1.4** as a named, frozen successor. Keep v1.3 evaluatable for replay. Default the live app to v1.4.

Hackathon ideas this may occupy without becoming a different product:

| Idea | How Cutout takes it |
|---|---|
| **IDEA-25** Transaction privacy simulator | Already the core. Make cover, timing (S3), amount leakage (S1/S5/S7) *visible* before sign. Never say “anonymity set”. |
| **IDEA-26** Drop-in component kit | `@cutout/guard` widget + evidence panel other sprint apps can install. Wallet submit stays out of the package. |
| **IDEA-21** Selective disclosure | Public receipt + evidence binding. Not viewing-key custody. |
| AVNU private swaps (hackathon banner) | Only if a public amount fingerprint exists at the swap edge. Otherwise honest `docs/AVNU.md`. |

### MUST ship

**E1. Second public edge: withdraw / unshield preflight**

Census: withdrawals are 2.4× deposits. Unshield amounts are the classic linkage fingerprint.

- Promote `withdraw` from `UnsupportedIntent` to a real typed action. Names must match the reviewed STRK20 ABI / Wallet API — inspect `src/starknet/actions.ts`, `src/starknet/abi.ts`, `fixtures/pool-abi.json`, Wallet API `strk20PrepareInvoke`.
- Activate **S2** and **S3** for withdraw with the threat-model definitions:
  - S2: counterpart event of the same token has an exactly equal amount in `observationSeconds` (linkage risk).
  - S3: deposit→withdraw delta ≤ `proximitySeconds` (3600) for the same token/amount class.
- Do **not** fire S2/S3 on shield. Do not overload shield scoring.
- Withdraw path is still: preflight → optional in-bounds recommendation → final preflight → simulate → user wallet. Cutout still does not sign.
- If Wallet API cannot yet submit withdraw through the current adapter, **preflight + simulate + deny unsigned** is still valuable. Do not fake a submit.
- UI: action switcher Deposit | Withdraw. Same evidence panel.
- Unsupported / mixed actions still fail closed. `private_transfer` stays unsupported (no public amount fingerprint for note-to-note).
- Update GUARD_POLICY mapping only if withdraw needs a different deny rule. If so, version it (`GUARD_POLICY-v2`), do not silently change v1.

**E2. Live public-cover map (read-only, same snapshot)**

Add `/cover` (or a first-class in-workflow panel) that renders, from the **current canonical snapshot only**:

- Per configured token (STRK, USDC, ETH, strkBTC): top exact-amount cohorts in trailing 24h — size, distinct addresses, burst share, active days, whether they would currently evaluate LOW/MEDIUM/HIGH
- The 35% “no prior exact match” fact as a **live statistic**, not a markdown claim
- Snapshot hash, block, source age, model version
- Durability so airdrop spikes are not offered as cover

This is how judges *see* STRK20 integration depth. No wallet required. If snapshot is unavailable, fail closed with the same designed empty state, or render last snapshot labeled STALE.

**E3. Amount ladder from live cohorts**

When the user is in Propose, show 3–7 **current** healthy-cover amounts for the selected token, generated from the snapshot (not a hardcoded list). Clicking one fills the exact amount and runs preflight. Still user-initiated. Still exact-amount. If exact mode (no flexibility), the ladder is information-only.

**E4. New recommendation kind `WAIT` + new signal S7**

- **S7 Unique-decimal / round-amount fingerprint.** Exact amounts like `0.01`, `1`, `100` with no prior exact cohort should fire. Integer base units, not floats. This is **not** S6.
- **Cover-now vs cover-wait.** If the amount is currently thin but the same token has a healthy nearby cohort, or a burst is dominating `maxBurstShare`, return:
  - `CHANGE_AMOUNT` (exists)
  - `WAIT` (new, non-signing, advisory, deterministic reason + suggested horizon bounded by `cohortSeconds`)
  - `NO_SAFER_EXECUTION` (exists)
- Never auto-wait. Never auto-submit later.

**E5. Drop-in integrator kit (IDEA-26)**

`@cutout/guard` already exists. Depth = **someone else can install it**.

- Export a documented React headless hook + a copy-pasteable evidence panel (CSS variables, no Next-only APIs).
- Expand `examples/guard-consumer` into: (a) Node preflight consumer (exists), (b) minimal Vite/Next widget that cannot submit.
- `docs/INTEGRATOR.md`: keep the 12-step flow; add a 30-line “paste into your STRK20 dapp” section.
- Keep wallet submit **out** of the package.
- Optional if time: `window.postMessage` / Wallet Standard middleware sketch. Do not build a browser extension.

### SHOULD ship if time

- Pool-level ViewingKeySet density as a displayed pool-health statistic (not a privacy guarantee).
- S6 conservation-of-value **scorecard** as the threat model defines it: post-execution, public amounts only, does not enter the band. Skip if it requires private notes.
- Receipt page: explorer link optional; binding table required. Durable URL (hash already in path).
- Disconnect wallet + Back to propose without a full reload.
- Persist nothing sensitive in `localStorage`. Intent lives in component state only.

### AVNU / swap (optional, high judge signal, easy to fake badly)

Hackathon page highlights “Private swaps are now live on AVNU”. Do **not** become a DEX.

If AVNU/STRK20 public events expose an exact amount at the public edge (shield-then-swap, or unshield-to-swap), add a **read-only** preflight that reuses CUTOUT cohort logic for that amount (`Action` already includes `"swap"`). If amounts are fully private and there is no public fingerprint, **do not invent a score** — write `docs/AVNU.md` explaining the non-integration honestly. Honesty scores. Fake AVNU depth does not.

### MUST NOT ship

- AI copy, AI risk scores, chat assistant
- Mixing / tumbling / delayed bundling that Cutout itself executes
- Extra tokens or extra pools without ABI review and config review
- Dark patterns that push the user to change amount
- “Anonymity set size” language
- Broadening `validateSingleDepositAction` into “any calldata”
- Note indexer, viewing-key custody, relayer scoring, on-chain Cutout router
- RFP poker / payroll / cards / bridges / pump.fun clones

### v1.4 versioning checklist

- `src/engine/constants.ts` gains `CUTOUT-v1.4` (keep v1.3 object)
- Preflight response includes `modelVersion`
- Guard package exports both versions; live app defaults to v1.4
- `tests/engine.test.ts` has v1.3 golden replay **and** v1.4 cases (withdraw S2/S3, S7, WAIT)
- Docs: THREAT_MODEL, GUARD_POLICY, PREFLIGHT_API, INTEGRATOR, ARCHITECTURE, SIGNING_WORKFLOW, PITCH, README all mention v1.4 honestly
- SignalResult.id becomes `"S1" | "S2" | "S3" | "S4" | "S5" | "S7"` (and S6 only if you actually ship the post-execution scorecard type, not as a preflight id)

---

## 9. Phase F — UI/UX polish with GSAP + Lenis

Load `$frontend-design` **before** CSS/JSX.

Cutout is a **signing instrument**, not a marketing landing page. Motion should feel like a notary desk + terminal: precise, reversible, quiet. If an animation makes a HIGH/DENY decision feel playful, it is wrong.

Dependencies already pinned (do not churn):

- `gsap@3.15.0`
- `@gsap/react@2.1.2`
- `lenis@1.3.26`
- `lucide-react@1.31.0`

Existing files to **extend, not replace**:

- `apps/web/app/_components/motion-provider.tsx` — Lenis + GSAP ticker + ScrollTrigger + reduced motion
- `apps/web/app/_components/motion-system.ts` — `useWorkflowMotion`, `useReceiptMotion`, `revealStatePanel`
- `apps/web/app/globals.css`
- `apps/web/app/_components/signing-workflow.tsx`

v0.1.2–v0.1.4 already started hierarchy, evidence disclosure, focus, reduced motion. Finish them. Do not restart the visual system.

### Motion requirements

1. **Lenis is the only smooth-scroll driver.** Keep `gsap.ticker` rAF sync. Call `ScrollTrigger.update` on Lenis scroll (already done). After every workflow state change that mutates layout, call `ScrollTrigger.refresh()`.
2. Set `gsap.ticker.lagSmoothing(0)` while Lenis owns rAF (current provider does not — this is a real desync bug).
3. **`[data-lenis-prevent]`** on: amount inputs, `<details>` evidence panels, any modal, copy buttons, the cover-map table if it inner-scrolls. Keep `syncTouch: false`.
4. **Reduced motion is a first-class mode.** When `prefers-reduced-motion: reduce` or `document.documentElement.dataset.motion === "reduced"`:
   - no Lenis
   - no ScrollTrigger pin
   - instant state swaps
   - CSS transitions off (already in globals — keep)
   - content still fully usable
5. **GSAP usage that must exist (wired to DOM via `useGSAP`):**
   - First paint: intro of header, title, flow rail, propose panel (stagger 40–70ms, 400–700ms, `power3.out`, y 8–16px only). Partially exists — complete the data attributes.
   - Flow rail: active step marker interpolates; completed steps check on; do not re-animate the whole rail on every keystroke.
   - State panel reveals: `data-state-reveal` when entering Verify / Review / Simulate / Receipt.
   - Evidence: signals S1–S7 stagger in; fired signals get a **one-time** emphasis (border/background), not a loop.
   - Decision band: HIGH / MEDIUM / LOW color + label morph with Flip or a single timeline; cohort size can count up **integers only**.
   - Recommendation: when user accepts `CHANGE_AMOUNT`, Flip the amount from old → new so the change is physically visible before final preflight.
   - Cover map: rows reveal on enter; no infinite marquees. Remove `.trust-marquee-track` if it still feels like ads.
   - Receipt success: a single confirmation timeline, then stillness.
   - Fail-closed empty state: a short, serious reveal, then static. Never a looping error bounce.
6. **Do not use GSAP for:** hover color, focus rings, spinner rotation (CSS is fine), layout that CSS grid already handles.
7. **Desktop pin:** keep rail pin at `min-width: 1024px` only. Kill it below that. No horizontal scroll at 390px.
8. **Cleanup:** every `useGSAP` context reverts. No leftover ScrollTriggers on unmount. Lenis destroyed on unmount (already in provider).

Register `Flip` only if you actually use it. Do not register unused GSAP plugins.

### Visual / UX requirements (judge-first, 15-second test)

A judge with **no wallet** must understand Cutout in 15 seconds and see STRK20 evidence without connecting Ready X.

1. Landing / explain layer above the signing tool (same route is fine, not a marketing site):
   - One sentence: public exact amounts fingerprint STRK20 deposits and withdrawals; Cutout checks cover before you sign.
   - Census proof (median 3; 35% zero cover) as a live or last-snapshot figure.
   - Non-claim: not a privacy guarantee.
   - Mainnet receipt link for Milestone 3.
   - Then the workflow.
2. Cover map is first-class.
3. Evidence hierarchy:
   - Band + decision + fired signals in human language
   - Candidate cohort vs traffic cohort (do not call either an anonymity set)
   - Quality failures: `THIN_COHORT`, `LOW_ADDRESS_DIVERSITY`, `TOP_ADDRESS_CONCENTRATION`, `INSUFFICIENT_ACTIVE_DAYS`, `BURST_CONCENTRATION`
   - Freshness: source age, index lag, snapshot hash, decision id
   - Recommendation delta as a number the user can accept or refuse
4. Flow rail: Propose → Verify → Review → Simulate → User Wallet. Owners: You / Cutout / Cutout / Wallet.
5. Fail-closed, WARN, DENY, ALLOW visually distinct using existing tokens (`--red`, `--amber`, `--green`, `--blue`). Do not invent neon.
6. Wallet states: connecting timeout, unsupported wallet, wrong network, user rejected, disconnect — each has a clear next action.
7. Amount input: integer-safe decimal entry, immediate validation, min>max flexibility caught before request.
8. Keyboard: visible focus (`--shadow-focus`), Enter submits the current step only, Esc collapses disclosures, rail is a `nav`.
9. Screen readers: `aria-live` already exists; GSAP `autoAlpha` must not hide live regions. Do not `display:none` the current step.
10. Mobile 390×844: single column, no pin, no horizontal overflow, 44px targets, Lenis touch left native.
11. Copy: short, specific, no “unlock your privacy journey.” Keep the honest tone of the README.

**No** purple gradients, **no** 3D heroes, **no** generic dashboard kits, **no** Inter swap (Geist is loaded).

Playwright: extend `apps/web/e2e/signing-workflow.spec.ts` and `receipt-view.spec.ts` for cover map, withdraw path (fixture), reduced-motion (`page.emulateMedia({ reducedMotion: 'reduce' })`), and a narrow viewport. Motion must not be required for the flow to complete. Load `$playwright` for this.

---

## 10. Phase G — Docs, demo, release hygiene

Update, do not bloat. Same PR/commit series as the code they describe.

- `README.md` — v0.2 / CUTOUT-v1.4, withdraw, cover map, honest limitations, current demo status
- `docs/ARCHITECTURE.md`, `THREAT_MODEL.md` (new frozen date only if signals/actions changed), `GUARD_POLICY.md` (or v2), `PREFLIGHT_API.md`, `SIGNING_WORKFLOW.md`, `INTEGRATOR.md`, `OPERATIONS.md`, `DEPLOYMENT.md`, `HEALTH.md`
- `docs/DEMO_RUNBOOK.md` — a 3-minute judge path that **starts from a healthy snapshot**. Include the cover map as visual proof of depth. Include a fixture fallback if RPC dies mid-demo, clearly labelled REPLAY / FIXTURE MODE
- `submission/PITCH.md`, `JUDGE_FAQ.md`, `DEMO_SCRIPT.md` — 30s pitch must name: public Deposit + Withdrawal + ViewingKeySet events, WalletAccountV6, `strk20PrepareInvoke(simulate:true)`, independent receipt, **and** withdraw edge + live cover map if shipped. 90-second path **without** requiring a mainnet submit: connect-or-skip, cover map, preflight WARN, recommendation, simulate-to-READY_FOR_CONFIRMATION
- `strk20.json` `demo_url` only if the demo serves evidence
- Changelog / GitHub release notes if you bump to `0.2.0`

Do not claim a new mainnet tx unless the user actually signs one. Historical Milestone 3 remains historical.

Keep the honest limitations. They are a feature.

---

## 11. Implementation rules

Small, reviewable commits. Suggested series:

1. `docs: add AGENTS.md and audit notes`
2. `audit: production snapshot unavailability and boundary review`
3. `fix: align db path, supervisor, health, empty state`
4. `feat: CUTOUT-v1.4 engine with S7/WAIT and v1.3 replay preserved`
5. `feat: withdraw/unshield typed preflight (S2/S3)`
6. `feat: live cover map and amount ladder`
7. `feat: guard package widget + preflight API for v1.4`
8. `ui: GSAP/Lenis instrument motion and token pass`
9. `test: engine, e2e, reduced-motion, package verify`
10. `docs: v1.4 threat model, demo runbook, pitch`

Match existing TypeScript style. Prefer extending `src/engine/evaluate.ts` over inventing a second engine. No `any`. No floating-point token math. Do not commit `.env`, SQLite data, or secrets.

---

## 12. Definition of done

A phase is not done because code exists. It is done when:

1. `docs/AUDIT_NOTES.md` exists and names production SNAPSHOT_UNAVAILABLE root cause with evidence.
2. Fail-closed still holds in tests; a stale snapshot cannot produce ALLOW.
3. CUTOUT-v1.3 golden replay still matches.
4. CUTOUT-v1.4 evaluates deposit **and** withdraw, with S1–S5 + S7, CHANGE_AMOUNT / WAIT / NO_SAFER_EXECUTION. S2/S3 fire on withdraw per threat model.
5. `/cover` (or equivalent) renders live cohort cover from the same snapshot as preflight. A judge needs no wallet to see STRK20 depth.
6. `@cutout/guard` still cannot sign; `npm run package:verify` passes. Integrator widget or 30-line paste exists.
7. GSAP + Lenis motion is wired, `lagSmoothing(0)` is set, reduced-motion is complete, mobile does not pin or horizontally scroll.
8. `npm run ci:verify` (or the strongest subset that runs) passes.
9. Demo runbook is a 3-minute path a judge can follow on a healthy snapshot, plus a labelled fixture fallback.
10. README / PITCH language still refuses to claim anonymity.
11. `strk20.json` `demo_url` is either a working demo or still empty — never a lie.

When finished, output:

- Finding summary (P0/P1/P2, fixed vs residual)
- What v1.4 adds to STRK20 depth, mapped to the 30/30/25/15 judging table
- Exact commands to run the indexer, web, e2e, and demo
- Anything that still requires the human (Ready X confirmation, host restart on rouma.online, a new mainnet tx)

Start with the skills inventory and Phase A. Then audit. Then fix availability. Then depth. Then motion. Then docs. In that order, unless a later phase is blocked by an earlier one — in which case say so and keep going on the unblocked work.
