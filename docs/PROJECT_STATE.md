# Project State

> Living handoff for Codex sessions. Read this file before working. Do not put
> secrets or raw credential-bearing values here.

Last updated: `2026-09-04T20:36:23Z`
Status: `COMPLETE`
Active objective: Deploy the verified tile-ledger presentation checkpoint and complete production visual/API QA without changing public-evidence, wallet, or transaction semantics.

## Workspace

- Repository: `https://github.com/dmetagame/cutout.git`
- Worktree: `/home/rouma/Starknet`
- Branch: `main`
- Reviewed/deployed checkpoint: `015f6d8a339385d3c734dfda805cbe4b70a73b81`; production checkout `/srv/cutout` is detached at this exact commit. The presentation implementation is `c7ede4c2d43ac9beabba9775da2142f7c44590c0`; `015f6d8` adds its state-only handoff.
- Implementation checkpoint: `2d829460809006582294bdc8bdfc81d2e82c4c5f` (`feat(web): refine signing instrument UI`)
- Current subtractive UI checkpoint: `91d6cedf8c8e43cdf05dc06f11184e32c8fe9882` (`ui: reduce signing instrument to ledger`), pushed to `origin/main`.
- Session base: `ced20ce5bd070d7ba4cf87d437ff8a8b2c842231`, clean and synchronized with freshly fetched `origin/main` before the tile-ledger work.
- Current tile-ledger checkpoint: `c7ede4c2d43ac9beabba9775da2142f7c44590c0` (`ui: turn public cover into tile ledger`), verified and pushed to `origin/main`.
- Deployment handoff checkpoint: `39a1b17b38cbe2392a916dd15493e9d060d5d0f3` (`docs: record tile ledger production deploy`), verified on `origin/main`; production intentionally remains at the exact application/state target `015f6d8` because this later commit only records the completed deployment.
- Worktree was clean and synchronized with `origin/main` immediately after the implementation push; this state-only handoff update records that remote checkpoint.
- GitHub connection: HTTPS fetch/push and `gh auth status` succeed as `dmetagame`; the deployment target was freshly fetched and matched local `HEAD`/`origin/main` before deployment.
- Protected releases/artifacts: immutable annotated tag `v0.2.0` remains at release commit `f34655b7b2f19b47b7fcdeec832fce39a455a6a7`; production adds later reviewed recovery and presentation-only commits without moving that tag.

## Constraints

- Follow `AGENTS.md` and `docs/agent/CUTOUT_CODEX_MASTER_PROMPT.md` before repository changes.
- Preserve frozen `CUTOUT-v1.3`, `GUARD_POLICY-v1`, and `FRESHNESS_POLICY-v1` replay behavior.
- Cutout remains a public-data STRK20 signing preflight. Ready X is the only signer.
- Never add backend keys, private-state access, autonomous signing, or transaction broadcasting.
- Uncertain, stale, incomplete, corrupt, or reorg-uncertain evidence must fail closed.
- Do not submit a mainnet transaction without explicit user authorization.

## Current Context

- Cutout v0.2.0 is complete. Production uses `CUTOUT-v1.4`; the v1.3 path remains replayable.
- Production was rebuilt from `015f6d8` on 2026-09-04 with the existing Compose project, `.env`, host-only override, and `cutout_cutout-data` volume preserved.
- Deposit is the only executable wallet path. Withdrawal support is intentionally analysis-only.
- The most recent archived project session ended with no unanswered implementation question and reported a clean, synchronized repository plus passing CI.
- Authoritative archived session ID: `019ffd5c-be70-71a0-96ff-fff52dc9b25e`.
- Transcript: `/home/rouma/.codex/sessions/2026/08/14/rollout-2026-08-14T00-02-21-019ffd5c-be70-71a0-96ff-fff52dc9b25e.jsonl`.

## Work Completed

- Located the actual repository at `/home/rouma/Starknet`; `/home/rouma/cutout-browser-profile` is browser state, not source code.
- Reconciled the repository identity, branch, commit, remote, release tag, and clean pre-handoff worktree.
- Recovered the original Cutout session from the local Codex archive and confirmed its final release handoff.
- Added this durable project-state document because the repository predated the workspace convention and had no `docs/PROJECT_STATE.md`.
- Rebuilt the presentation cascade in `apps/web/app/globals.css` around one paper/ink token set, one page-width scale, responsive 390px cover cards, visible focus, and 44px mobile controls.
- Reworked `signing-workflow.tsx` presentation semantics: compact product explanation, first-class unmatched-share metric, native full-row cohort selection, selected-row state, connected exact-mode auto-preflight, explicit analysis-only withdrawal framing, proposal form submission on Enter, skip link, and Escape-close disclosures.
- Extended the existing motion system with restrained intro/row/state timelines, desktop-only rail pinning, interpolated rail state, one-shot fired-signal treatment, integer evidence counts, risk-band morphing, amount Flip, receipt stillness, and live-region-safe reveals.
- Brought the receipt presentation under the same motion/focus/skip-link and disclosure behavior without changing receipt validation.
- Added UI Playwright coverage for full-row cover selection, connected auto-preflight, Enter/Escape behavior, 390px cards, reduced motion, and receipt disclosures.
- Added the requested README note and pushed the verified implementation checkpoint to `origin/main`.
- Took a consistent pre-deployment backup after stopping the writer/API and checkpointing WAL because the host lacked space for another in-volume copy. The verified copy is `/home/rouma/cutout-backups/pre-39a49e1-20260902T205118Z.sqlite` (`4,872,781,824` bytes; SHA-256 `f6abee372a2dcdf1df4e92bd07d3df7150bb26059afe27c0608b3d9155e027d7`; schema `4`; model `CUTOUT-v1.4`; `quick_check: ok`).
- Rebuilt and recreated only the `indexer` and `api` containers with `docker compose up --build -d`; retained the named SQLite volume and its prior backups.
- Ran live Playwright QA at 1280x800 and 390x844 with enhanced and reduced motion. The connected simulation-only harness stopped at `READY_FOR_CONFIRMATION` with `connectCalls=1`, `prepareCalls=1`, and `invokeCalls=0`.
- No product source, engine, policy, indexer logic, API, wallet adapter, or guard-package export changed during deployment/QA.
- Subtractive UI work is based on `eb8703a827b5c5a7c06634ec2929445a5c88dae4`, which matched freshly fetched `origin/main` at the 2026-09-04 checkpoint.
- Removed the always-visible flow rail, authority strip, duplicated hero proposal, snapshot stamp, disconnected evidence theater, decorative wallet/shield/activity icons, pill styling, and paper-card shadows.
- Reframed the entry as a flat ledger: four corner facts, one 15px sentence, the sole large unmatched-share metric, exact-amount cells, a compact proposal, and evidence mounted only after a real decision.
- Reduced entry motion to the one-time cover-cell hinge and amount Flip; eliminated rail/title sequences while retaining Lenis ownership, reduced-motion behavior, and state-layout refreshes.
- Updated Playwright assertions for absent pre-decision evidence/rail, explicit withdrawal analysis-only copy, and 44px mobile Connect/Check targets.
- Replaced the healthy-state header, intro, table chrome, and duplicated proposal controls with four corner facts, one 15px sentence, the unmatched-share metric, and exact-amount ledger cells.
- Mapped each real cover cohort to a keyboard-operable cell showing amount, projected cohort, public actors, active days, and band; hover/focus/selection dims the other cells without changing the selection or preflight path.
- Added a one-time GSAP cell-face hinge (`0.34s`, `0.04s` stagger; seven-row maximum completes in `0.58s`), a Flip transfer from a chosen amount into the proposal field, and a single entering result plate after a real decision.
- Kept reduced motion static and complete: tile faces render immediately, result plates do not translate, Lenis remains disabled, and no `aria-live` content is hidden.
- Removed decorative Lucide marks from the signing workflow while retaining functional loading, refresh, and disclosure indicators.
- Stopped the single production writer and read-only API, checkpointed WAL, and streamed a consistent pre-deployment copy to `/mnt/c/Users/predator triton/Documents/cutout-backups/pre-015f6d8-20260904T145210Z.sqlite` because neither the host nor Linux workspace had enough safe headroom for another 4.87 GB copy.
- Verified the new rollback copy against the stopped source: exact size `4,872,781,824` bytes; matching SHA-256 `fc56a513535ca2dad988eb0b07211e24884e883d128f78d03cf3348eec0d7de1`; schema `4`; mainnet/pool identity; `STRK20_POOL_ABI-v2`; `CUTOUT-v1.4`; `PRAGMA quick_check = ok`.
- Fetched and detached production `/srv/cutout` at exact commit `015f6d8`, retained the existing untracked host healthcheck override, validated Compose, and rebuilt/recreated only `indexer` and `api` with the named SQLite volume intact.
- Completed public post-deploy QA: current healthy snapshot/model/policies, one active `:root`, tile-ledger markers, HTTP 308 redirect, 1280 and 390 renders, reduced motion, zero overflow, seven revealed cells, clickable selection, unmounted idle evidence, 44px Connect target, and no browser errors.
- Ran public-data-only API smokes: an unsupported token failed closed, and configured USDC returned `AVAILABLE / ALLOW / LOW` against the same snapshot. No wallet API was connected or invoked and no transaction was prepared, signed, broadcast, or submitted.

## Decisions And Rejected Alternatives

- Extended the existing light paper/ink system as a compact notary-desk/terminal instrument; rejected a new dashboard theme, gradients, glass surfaces, and ornamental marketing treatment.
- Kept one semantic cover dataset and rendered each row as one native button-cell at every viewport; rejected a separate mobile component that could drift from the public evidence.
- Made disconnected cover selection fill the proposal and focus Connect; connected exact-mode selection runs the same existing preflight. Wallet and transaction semantics remain unchanged.
- Used native form/details/button semantics plus the pinned GSAP/Lenis stack; rejected Framer Motion, a new CSS framework, and custom div controls.
- Rejected a portfolio/photo-grid treatment and a fake countdown; the only animation reveals current snapshot data and then stops.
- Reused the ledger action/token controls as the proposal source of truth and removed their duplicate form controls; transaction meaning and typed intent construction are unchanged.

## Verification

| Check | Result | Evidence/date |
| --- | --- | --- |
| Repository identity | passed | `git rev-parse --show-toplevel`; `git remote -v`; 2026-09-02 |
| Branch and upstream | passed | `main`, aligned with `origin/main` before state-file creation; 2026-09-02 |
| Commit deployed | passed | Production `/srv/cutout` detached at `015f6d8a339385d3c734dfda805cbe4b70a73b81`; 2026-09-04 |
| Pre-handoff worktree | clean | `git status --short --branch`; 2026-09-02 |
| Release evidence | previously passed | Final archived handoff records GitHub Actions run `32637764286`; 2026-08-23 |
| Live production health | passed | `curl https://cutout.rouma.online/api/health` returned `HEALTHY`; 2026-09-02 |
| Web TypeScript | passed | `npm run web:typecheck`; 2026-09-02T16:23Z |
| Focused Playwright regression rerun | passed | Four formerly failing recommendation/Flip/responsive/simulation cases, `4 passed (1.1m)`; 2026-09-02 |
| Full Playwright rerun | passed | `npm run test:e2e`: `18 passed (2.7m)`; 2026-09-02T19:44Z |
| Full CI | passed | `npm run ci:verify`: 155 core tests, 21 milestone-4 tests, 5 milestone-5 tests, 4 package tests, package consumer, typechecks, production web build, 18 Playwright tests, and diff check passed; 2026-09-02T19:50Z |
| Pre-deployment backup | passed | Exact byte/hash match; schema `4`; `CUTOUT-v1.4`; `STRK20_POOL_ABI-v2`; `PRAGMA quick_check = ok`; 2026-09-03 |
| Compose rebuild | passed | `docker compose config --quiet`; `docker compose up --build -d`; retained `cutout_cutout-data`; containers run as `node`, `CapDrop=ALL`, `no-new-privileges`, zero restarts; 2026-09-03 |
| Live deployment gate | passed | New hero and full-row cover controls served; active CSS has one `:root`; analysis-only withdrawal and responsive/reduced-motion rules present; 2026-09-03 |
| Live Playwright QA | passed | 1280x800 and 390x844, enhanced/reduced motion, no overflow or browser errors, cover auto-preflight, keyboard/focus/disclosure, simulation-only Ready state, zero invoke calls; 2026-09-03 |
| Web TypeScript rerun | passed | `npm run web:typecheck`; 2026-09-03 |
| Full Playwright rerun | passed | `npm run test:e2e`: `18 passed (1.8m)`; 2026-09-03 |
| Final production health | passed | `HEALTHY`, ready, current complete snapshot, model `CUTOUT-v1.4`, source age `26s`, index lag `3s`; 2026-09-03T08:06Z |
| Current live health | passed | `HEALTHY`, current complete snapshot, `CUTOUT-v1.4`; 2026-09-04 |
| Subtractive web typecheck | passed | `npm run web:typecheck`; 2026-09-04 |
| Subtractive Playwright suite | passed | `npm run test:e2e`: 18 passed; the simulation harness still stops before invoke; 2026-09-04 |
| Optimized web build | passed | `npm run web:build`; production Next.js compilation and route generation passed; 2026-09-04 |
| Rendered visual measurements | passed | 1280/390: title 28/23.2px, metric 48/42.4px, Connect and Check 44px, `scrollWidth == clientWidth`, no rail, no initial evidence surface, no surface shadow; reduced mode had no Lenis or hidden motion targets; 2026-09-04 |
| Before/after captures | passed | Live before and local fixture after captured at 1280x800 and 390x844 under `/tmp/cutout-{before,after}-*.png`; 2026-09-04 |
| Tile-ledger web typecheck | passed | `npm run web:typecheck`; 2026-09-04T14:04Z |
| Tile-ledger Playwright suite | passed | `npm run test:e2e`: 18 passed in 2.9m, including 390px, reduced motion, analysis-only withdrawal, and simulation stopping before invoke; 2026-09-04T14:04Z |
| Tile-ledger visual QA | passed | Playwright CLI live baseline at 1280x800/390x844 plus local enhanced, result-plate, and reduced-motion captures; no horizontal overflow or hidden reduced-motion content; 2026-09-04 |
| Live health during tile-ledger session | passed | Public `/api/health`: `HEALTHY`, current complete snapshot, `CUTOUT-v1.4`; 2026-09-04 |
| Tile-ledger pre-deployment backup | passed | `4,872,781,824` bytes; source/copy SHA-256 `fc56a513535ca2dad988eb0b07211e24884e883d128f78d03cf3348eec0d7de1`; schema `4`; ABI v2; model v1.4; `quick_check: ok`; 2026-09-04 |
| Tile-ledger Compose deploy | passed | Exact `015f6d8` checkout; existing `.env`, host override, and `cutout_cutout-data` retained; build/typecheck/routes passed; both containers healthy with zero restarts; 2026-09-04 |
| Tile-ledger public browser QA | passed | 1280x800 and 390x844 enhanced plus 390x844 reduced; seven cells visible, click selects one cell, evidence absent before decision, 44px Connect, no overflow/console/page/request errors; 2026-09-04 |
| Tile-ledger public API smoke | passed | Unsupported token failed closed; configured USDC returned `200 AVAILABLE / ALLOW / LOW` on the health snapshot; no wallet or transaction call; 2026-09-04 |
| Tile-ledger final live gate | passed | HTTP redirects 308 to HTTPS; `/api/health` returned `200 HEALTHY`, current complete snapshot, `CUTOUT-v1.4`, source age `30s`, index lag `12s`; active CSS has one `:root`; 2026-09-04T20:34Z |
| Deployment handoff remote backup | passed | Commit `39a1b17b38cbe2392a916dd15493e9d060d5d0f3` pushed to and read directly from `origin/main`; production recovered from a normal brief `SYNCING` sample to `HEALTHY / COMPLETE`, source age `28s`, index lag `9s`; 2026-09-04T20:36Z |

## Risks And Blockers

- No current implementation blocker is recorded.
- Production root storage is 91% used with about 3.7 GB free after rebuild; the named Cutout volume remains about 21 GB, including retained historical backups. No volume or backup data was deleted. Capacity remains an operational risk.
- The verified pre-`39a49e1` backup remains in `/home/rouma/cutout-backups` rather than on the production host because the host could not hold another 4.87 GB copy. Move it to managed durable storage without deleting the retained production volume.
- The production clone has no `origin/main` remote-tracking ref; deployment used a verified `FETCH_HEAD` and detached checkout at the exact requested commit.
- The archived session is very large and contains historical operational context. Prefer this state file and reviewed repository docs over replaying the full transcript.
- The current turn is presentation-only. Engine, policies, indexer, API, wallet adapter, and `@cutout/guard` exports are outside scope.
- Production is now on `015f6d8`; the tile-ledger presentation is live and verified.
- The new pre-`015f6d8` backup is on the operator workstation's Windows-mounted disk. It is verified and independent of the production host, but should also be moved to managed durable backup storage.

## Next Actions

1. Monitor the deployed `015f6d8` presentation and current snapshot health; no further code or deployment action is pending.
2. Move the verified pre-`015f6d8` backup to managed durable storage while retaining the active SQLite volume and at least one known-good rollback copy.
3. Plan production disk-capacity maintenance without deleting the active SQLite volume or unreviewed retained backups.

## Session Handoff

- Start with `AGENTS.md`, `docs/PROJECT_STATE.md`, `docs/AUDIT_NOTES.md`, and `docs/DEPLOYMENT.md`.
- The original session began from `/home/rouma`, then performed the Cutout work in `/home/rouma/Starknet`; directory metadata alone is therefore insufficient to identify it.
- The session-memory MCP tools documented by the installed handoff skills were unavailable, so the authoritative local JSONL archive was inspected directly.
- In the 2026-09-02 implementation session, UI presentation code and tests changed while engine/policy/API/wallet semantics, deployment, release tags, and production state did not change.
- The 2026-09-04 deployment changed production presentation only: remote checkout `015f6d8`, Compose project `cutout`, containers `cutout-indexer-1` and `cutout-api-1`, shared volume `cutout_cutout-data`.
- Post-deploy public QA made public preflight requests and one simulated wallet preparation only. It did not call `wallet_strk20InvokeTransaction`, confirm, broadcast, or create a transaction hash.

## Change Log

| Timestamp | Session/agent | Event | Result |
| --- | --- | --- | --- |
| 2026-09-02T14:09:44Z | Codex `/root` | Located Cutout repository and original archived session; reconciled release state; created durable handoff | Repository found at `/home/rouma/Starknet`; v0.2.0 remains protected; no implementation or production change |
| 2026-09-02T16:00:05Z | Codex `/root` | Accepted a UI/UX-only pass; inventoried skills, loaded design/GSAP/a11y/Playwright guidance, and captured live desktop/mobile baselines | Scope frozen to presentation; production health read-only check returned `HEALTHY`; design direction set to a compact public-evidence docket |
| 2026-09-02T16:23:52Z | Codex `/root` | Implemented the first UI/UX pass across workflow, receipt, motion, and the consolidated token layer | Full-row cover selection and keyboard/reduced-motion paths are wired; `npm run web:typecheck` passes; visual/e2e/CI verification remains |
| 2026-09-02T19:39:28Z | Codex `/root` | Reconciled Git/GitHub under the updated durability rules and recorded focused regression verification | `main` remains at `327717b`/`origin/main`; GitHub auth passes; four focused Playwright regressions pass; scoped work is not yet committed or pushed |
| 2026-09-02T19:44:19Z | Codex `/root` | Completed the full UI Playwright verification after the responsive-pin and Flip fallback fixes | `npm run test:e2e` passed all 18 tests; full CI remains |
| 2026-09-02T19:50:13Z | Codex `/root` | Completed the repository-wide verification and cleaned the disposable Playwright run marker | `npm run ci:verify` passed; scoped diff is whitespace-clean; ignored `test-results/` created by this task was removed |
| 2026-09-02T20:06:05Z | Codex `/root` | Created and remotely backed up the implementation checkpoint | Commit `2d829460809006582294bdc8bdfc81d2e82c4c5f` pushed to `origin/main`; GitHub auth/fetch/push verified; no branch protection was configured |
| 2026-09-03T08:06:48Z | Codex `/root` | Backed up the live database, redeployed presentation checkpoint `39a49e1`, and completed production visual QA | Backup hash/integrity passed; Compose retained the SQLite volume; live health and all browser gates passed; simulation stopped at Ready with zero invoke calls |
| 2026-09-04T00:08:00Z | Codex `/root` | Completed the subtractive ledger implementation and local production visual QA | Removed generated chrome without changing workflow semantics; typecheck, optimized build, and 18 Playwright tests pass; checkpoint commit/push pending |
| 2026-09-04T09:06:32Z | Codex `/root` | Created and remotely backed up the subtractive UI checkpoint | Commit `91d6cedf8c8e43cdf05dc06f11184e32c8fe9882` pushed to `origin/main`; local and upstream refs match; production was not redeployed |
| 2026-09-04T14:04:07Z | Codex `/root` | Completed the data-native tile-ledger mechanic and local visual QA | Four corner facts replace idle chrome; real cohort cells flip once, selections Flip into the form, result evidence enters as a second plate; typecheck and all 18 E2E tests pass |
| 2026-09-04T14:05:22Z | Codex `/root` | Created and remotely backed up the tile-ledger checkpoint | Commit `c7ede4c2d43ac9beabba9775da2142f7c44590c0` pushed to `origin/main`; local and upstream refs matched immediately after push; production was not redeployed |
| 2026-09-04T20:34:15Z | Codex `/root` | Backed up the production read model, deployed the tile-ledger checkpoint, and completed public production QA | Backup byte/hash/identity/integrity passed; production is detached at `015f6d8`; Compose retained `cutout_cutout-data`; health, API, desktop/mobile/reduced-motion, security, and no-transaction gates passed |
| 2026-09-04T20:36:23Z | Codex `/root` | Created and remotely backed up the deployment handoff | Commit `39a1b17b38cbe2392a916dd15493e9d060d5d0f3` pushed to `origin/main` and verified with `git ls-remote`; production stayed on exact deployed target `015f6d8` and returned to `HEALTHY / COMPLETE` after one normal `SYNCING` observation |
