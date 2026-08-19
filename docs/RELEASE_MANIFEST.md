# Cutout v0.1.3 Release Manifest

**Prepared:** 2026-08-19
**Release identity:** `v0.1.3`; after release, the commit resolved by the
annotated tag is authoritative.

## Identity

| Field | Value |
|---|---|
| Prior immutable release | `v0.1.2` / `e9595295314932aad20d9f04933ade1e3ee212bc` |
| Earlier immutable release | `v0.1.1` / `72cc32d3637af589486eda28c1dee2cdba7f3474` |
| Initial immutable release | `v0.1.0` / `ac0516e2114134c8aa878de032c958a9b94bb6ee` |
| Parent commit before patch | `e9595295314932aad20d9f04933ade1e3ee212bc` |
| Repository tag | `v0.1.3` |
| Package | `@cutout/guard@0.1.3` |
| Package API | `CUTOUT_GUARD_API-v1` |
| Engine | `CUTOUT-v1.3` |
| Guard policy | `GUARD_POLICY-v1` |
| Freshness policy | `FRESHNESS_POLICY-v1` |
| Receipt schema | `CUTOUT_RECEIPT-v1` |
| Network | Starknet Mainnet (`0x534e5f4d41494e`) |
| Pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

The `v0.1.0`, `v0.1.1`, and `v0.1.2` tags and releases are immutable prior
releases and are not rewritten. The v0.1.3 commit is intentionally identified by its
annotated tag rather than embedding its own commit hash in this file, because
changing a file to contain that hash would change the commit. Resolve it with
`git rev-parse v0.1.3^{commit}` after tagging.

## Patch scope

v0.1.3 is a narrow presentation/integrity patch on top of v0.1.2. Before a
session-stored receipt can render as verified evidence, the receipt page now
validates its exact artifact structure and recomputes the existing deterministic
receipt ID over the displayed fields. Focused E2E coverage rejects mutated
artifacts and checks explorer navigation, keyboard focus, reduced motion, and
390px overflow behavior. Deployment chronology and judge-facing materials are
also updated for the live production demo.

The exact application/test source files are:

```text
apps/web/app/_components/receipt-view.tsx
apps/web/e2e/receipt-view.spec.ts
```

No CUTOUT-v1.3 rule, GUARD_POLICY-v1 rule, FRESHNESS_POLICY-v1 rule, API
contract, indexer behavior, database schema, guard validation, receipt
verification, wallet adapter, supported action, or transaction semantics
changed. The receipt-page check does not replace or modify the independent
public `verifyDepositReceipt` path. No new wallet confirmation or Starknet
transaction was performed.

The v0.1.2 presentation improvements to the Propose -> Verify -> Review -> Sign
hierarchy, evidence disclosure, recommendation comparison, signing boundary,
responsive layout, focus states, receipt navigation, and reduced motion remain
the immutable baseline for this patch.

## Live evidence boundary

The latest live wallet evidence remains the v0.1.1 non-submitting Ready X run;
it is retained here for release context and is not a v0.1.3 smoke test.

| Field | Value |
|---|---|
| Browser/wallet | Chrome 151 / Ready X `5.33.8` |
| Wallet API | `0.10.3` |
| Chain | Starknet Mainnet (`0x534e5f4d41494e`) |
| Action | One `0.01 STRK` deposit (`0x2386f26fc10000`) |
| Snapshot block | `13,448,562` |
| Snapshot hash | `0x494e624cf0afd9ba4d2abd52ab61ded11f597052ec782cc42836b7cde54e1cb8` |
| Decision | `LOW / ALLOW` |
| Decision ID | `0x9635829c45c3bf5ef1208049e984b0373be7fd3598f14e348a737007b2dab29e` |
| Wallet method | `wallet_strk20PrepareInvoke`, `simulate: true` |
| Final state | `READY_FOR_CONFIRMATION` |
| Invoke/broadcast method | Not called |
| Transaction hash | Not produced |
| Transaction submission | None |

The v0.1.2 production browser smoke used a simulation-only Wallet Standard
harness and reached `READY_FOR_CONFIRMATION` with `connectCalls=1`,
`prepareCalls=1`, and `invokeCalls=0`. It produced no transaction hash and did
not call confirmation or submission. The v0.1.3 release repeats the
non-submitting boundary after deployment.

## Historical Milestone 3 transaction

| Field | Value |
|---|---|
| Transaction | `0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e` |
| Action | One `0.01 STRK` deposit |
| Status | `SUCCEEDED / ACCEPTED_ON_L2` |
| Block | `13,427,531` |
| Snapshot | `0xbe131fcf5f63309e40b8e3656465e56bac7f5b8a1b8d5336974071bfabc34acf` |
| Receipt artifact | `0x09adfe7664898666360052a35a9e3551e1c343c14fff37ea6d6fafb9046d643c` |

This is historical execution evidence only. It is not reused as a v0.1.3
transaction.

## Verification record

| Check | Result |
|---|---|
| Root regression suite | `135 passed, 0 failed` |
| Milestone 4 focused suite | `18 passed, 0 failed` |
| Milestone 5 focused suite | `5 passed, 0 failed` |
| Package public API suite | `3 passed, 0 failed` |
| Browser E2E | `9 passed, 0 failed` |
| Root/web typechecks | Passed |
| Next.js production build | Passed |
| Packed consumer install/typecheck/run | Passed |
| Visual fixture harness | Passed |
| Desktop/mobile layout and 390px overflow checks | Passed |
| Keyboard focus and reduced-motion checks | Passed |
| Dependency audit | `0 vulnerabilities` |
| `git diff --check` | Passed |
| Wallet harness boundary | `connectCalls=1`, `prepareCalls=1`, `invokeCalls=0` |

## Patch commit file set

Ignored local state such as `data/`, `dist/`, `.next/`, `node_modules/`,
Playwright output, `.env`, `.npmrc`, package tarballs, logs, screenshots, and
browser profiles is excluded.

```text
README.md
apps/web/app/_components/receipt-view.tsx
apps/web/e2e/receipt-view.spec.ts
docs/DEMO_RUNBOOK.md
docs/DEPLOYMENT.md
docs/FINAL_SECURITY_REVIEW.md
docs/INTEGRATOR.md
docs/RELEASE_AUDIT.md
docs/RELEASE_EVIDENCE.md
docs/RELEASE_MANIFEST.md
package-lock.json
package.json
packages/guard/package.json
submission/DEMO_SCRIPT.md
submission/GITHUB_RELEASE_NOTES.md
submission/JUDGE_FAQ.md
submission/PITCH.md
submission/README.md
```

## External release state

- The annotated `v0.1.3` tag resolves the release commit; prior tags are not
  moved or rewritten.
- GitHub release publication is separate from the Git object and requires
  authenticated remote publication plus CI verification.
- npm publication remains separate and requires authenticated `@cutout` scope
  authorization; this environment is not assumed to be authenticated.
- The existing production target is `https://cutout.rouma.online`. Deployment
  identity, health, freshness, preflight, and wallet-call evidence are verified
  separately after the tagged revision is deployed.
- Ongoing backup, restart, rollback, and administrative access controls remain
  host-operator responsibilities.

## Release procedure

```text
git commit -m "Prepare Cutout v0.1.3 release"
git tag -a v0.1.3 -m "Cutout v0.1.3"
```

Verify with `git rev-parse v0.1.3^{commit}` and
`git rev-parse v0.1.3^{tag}`. Do not move or rewrite `v0.1.0`, `v0.1.1`, or
`v0.1.2`.
