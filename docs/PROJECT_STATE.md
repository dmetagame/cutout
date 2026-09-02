# Project State

> Living handoff for Codex sessions. Read this file before working. Do not put
> secrets or raw credential-bearing values here.

Last updated: `2026-09-02T20:06:05Z`
Status: `COMPLETE`
Active objective: Improve Cutout v0.2.0 presentation hierarchy, cover selection, motion, accessibility, and 390px responsiveness without changing transaction or evidence semantics.

## Workspace

- Repository: `https://github.com/dmetagame/cutout.git`
- Worktree: `/home/rouma/Starknet`
- Branch: `main`
- Implementation checkpoint: `2d829460809006582294bdc8bdfc81d2e82c4c5f` (`feat(web): refine signing instrument UI`)
- Worktree state at implementation checkpoint: clean and synchronized with `origin/main`; this state-only handoff update is the direct follow-up.
- GitHub connection: `gh auth status` passed for `dmetagame`; HTTPS `origin` is configured; a fresh `git fetch origin main` showed no remote divergence; the checkpoint push was verified.
- Protected releases/artifacts: immutable annotated tag `v0.2.0` at release commit `f34655b7b2f19b47b7fcdeec832fce39a455a6a7`; production runtime was last documented at reviewed commit `3bba285fa52bbe01cbaa676337b0111c3e2ef180`.

## Constraints

- Follow `AGENTS.md` and `docs/agent/CUTOUT_CODEX_MASTER_PROMPT.md` before repository changes.
- Preserve frozen `CUTOUT-v1.3`, `GUARD_POLICY-v1`, and `FRESHNESS_POLICY-v1` replay behavior.
- Cutout remains a public-data STRK20 signing preflight. Ready X is the only signer.
- Never add backend keys, private-state access, autonomous signing, or transaction broadcasting.
- Uncertain, stale, incomplete, corrupt, or reorg-uncertain evidence must fail closed.
- Do not submit a mainnet transaction without explicit user authorization.

## Current Context

- Cutout v0.2.0 is complete. Production uses `CUTOUT-v1.4`; the v1.3 path remains replayable.
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

## Decisions And Rejected Alternatives

- Extended the existing light paper/ink system as a compact notary-desk/terminal instrument; rejected a new dashboard theme, gradients, glass surfaces, and ornamental marketing treatment.
- Kept one semantic cover table and restyled its rows as mobile cards; rejected a separate mobile-only data component that could drift from the public evidence.
- Made disconnected cover selection fill the proposal and focus Connect; connected exact-mode selection runs the same existing preflight. Wallet and transaction semantics remain unchanged.
- Used native form/details/table/button semantics plus the pinned GSAP/Lenis stack; rejected Framer Motion, a new CSS framework, and custom div controls.

## Verification

| Check | Result | Evidence/date |
| --- | --- | --- |
| Repository identity | passed | `git rev-parse --show-toplevel`; `git remote -v`; 2026-09-02 |
| Branch and upstream | passed | `main`, aligned with `origin/main` before state-file creation; 2026-09-02 |
| Commit | passed | `327717bcf2ab6640377b4efd46bb8b1370c105da`; 2026-09-02 |
| Pre-handoff worktree | clean | `git status --short --branch`; 2026-09-02 |
| Release evidence | previously passed | Final archived handoff records GitHub Actions run `32637764286`; 2026-08-23 |
| Live production health | passed | `curl https://cutout.rouma.online/api/health` returned `HEALTHY`; 2026-09-02 |
| Web TypeScript | passed | `npm run web:typecheck`; 2026-09-02T16:23Z |
| Focused Playwright regression rerun | passed | Four formerly failing recommendation/Flip/responsive/simulation cases, `4 passed (1.1m)`; 2026-09-02 |
| Full Playwright rerun | passed | `npm run test:e2e`: `18 passed (2.7m)`; 2026-09-02T19:44Z |
| Full CI | passed | `npm run ci:verify`: 155 core tests, 21 milestone-4 tests, 5 milestone-5 tests, 4 package tests, package consumer, typechecks, production web build, 18 Playwright tests, and diff check passed; 2026-09-02T19:50Z |

## Risks And Blockers

- No current implementation blocker is recorded.
- The archived session is very large and contains historical operational context. Prefer this state file and reviewed repository docs over replaying the full transcript.
- The current turn is presentation-only. Engine, policies, indexer, API, wallet adapter, and `@cutout/guard` exports are outside scope.

## Next Actions

1. No implementation action remains for this UI/UX pass.
2. Deployment is optional and was not part of this session; if requested, deploy the reviewed `main` checkpoint through the existing procedure and recheck `/api/health` plus the non-submitting public flow.

## Session Handoff

- Start with `AGENTS.md`, `docs/PROJECT_STATE.md`, `docs/AUDIT_NOTES.md`, and `docs/DEPLOYMENT.md`.
- The original session began from `/home/rouma`, then performed the Cutout work in `/home/rouma/Starknet`; directory metadata alone is therefore insufficient to identify it.
- The session-memory MCP tools documented by the installed handoff skills were unavailable, so the authoritative local JSONL archive was inspected directly.
- UI presentation code and tests changed; engine/policy/API/wallet semantics, deployment, release tags, and production state did not change.

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
