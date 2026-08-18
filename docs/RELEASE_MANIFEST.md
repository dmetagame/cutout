# Cutout v0.1.2 Release Manifest

**Prepared:** 2026-08-18
**Release identity:** `v0.1.2`; after release, the commit resolved by the
annotated tag is authoritative.

## Identity

| Field | Value |
|---|---|
| Prior immutable release | `v0.1.1` / `72cc32d3637af589486eda28c1dee2cdba7f3474` |
| Earlier immutable release | `v0.1.0` / `ac0516e2114134c8aa878de032c958a9b94bb6ee` |
| Parent commit before patch | `72cc32d3637af589486eda28c1dee2cdba7f3474` |
| Repository tag | `v0.1.2` |
| Package | `@cutout/guard@0.1.2` |
| Package API | `CUTOUT_GUARD_API-v1` |
| Engine | `CUTOUT-v1.3` |
| Guard policy | `GUARD_POLICY-v1` |
| Freshness policy | `FRESHNESS_POLICY-v1` |
| Receipt schema | `CUTOUT_RECEIPT-v1` |
| Network | Starknet Mainnet (`0x534e5f4d41494e`) |
| Pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

The `v0.1.0` and `v0.1.1` tags and releases are immutable prior releases and
are not rewritten. The v0.1.2 commit is intentionally identified by its
annotated tag rather than embedding its own commit hash in this file, because
changing a file to contain that hash would change the commit. Resolve it with
`git rev-parse v0.1.2^{commit}` after tagging.

## Patch scope

v0.1.2 is a presentation-only patch for the signing decision and public receipt
surfaces. It improves the Propose -> Verify -> Review -> Sign hierarchy,
progressive evidence disclosure, recommendation comparison, explicit
simulation-versus-signing language, responsive layouts, visible focus states,
receipt navigation, and reduced-motion behavior. The flow rail was corrected so
connected and wallet-error states do not appear to be ready to sign.

The exact UI source files are:

```text
apps/web/app/_components/signing-workflow.tsx
apps/web/app/_components/receipt-view.tsx
apps/web/app/globals.css
```

No CUTOUT-v1.3 rule, GUARD_POLICY-v1 rule, FRESHNESS_POLICY-v1 rule, API
contract, indexer behavior, database schema, guard validation, receipt
verification, wallet adapter, supported action, or transaction semantics
changed. No new wallet confirmation or Starknet transaction was performed.

## Live evidence boundary

The latest live wallet evidence remains the v0.1.1 non-submitting Ready X run;
it is retained here for release context and is not a v0.1.2 smoke test.

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

The v0.1.2 browser verification used the deterministic fixture/harness for UI,
responsive, receipt, focus, and reduced-motion checks. It did not claim fresh
mainnet data and did not call confirmation or submission.

## Historical Milestone 3 transaction

| Field | Value |
|---|---|
| Transaction | `0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e` |
| Action | One `0.01 STRK` deposit |
| Status | `SUCCEEDED / ACCEPTED_ON_L2` |
| Block | `13,427,531` |
| Snapshot | `0xbe131fcf5f63309e40b8e3656465e56bac7f5b8a1b8d5336974071bfabc34acf` |
| Receipt artifact | `0x09adfe7664898666360052a35a9e3551e1c343c14fff37ea6d6fafb9046d643c` |

This is historical execution evidence only. It is not reused as a v0.1.2
transaction.

## Verification record

| Check | Result |
|---|---|
| Root regression suite | `135 passed, 0 failed` |
| Milestone 4 focused suite | `18 passed, 0 failed` |
| Milestone 5 focused suite | `5 passed, 0 failed` |
| Package public API suite | `3 passed, 0 failed` |
| Browser E2E | `7 passed, 0 failed` |
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
apps/web/app/_components/signing-workflow.tsx
apps/web/app/globals.css
docs/FINAL_SECURITY_REVIEW.md
docs/INTEGRATOR.md
docs/RELEASE_AUDIT.md
docs/RELEASE_EVIDENCE.md
docs/RELEASE_MANIFEST.md
package-lock.json
package.json
packages/guard/package.json
submission/GITHUB_RELEASE_NOTES.md
submission/JUDGE_FAQ.md
submission/PITCH.md
submission/README.md
```

## External release state

- Git commit and annotated tag are owner-controlled local Git actions and are
  complete only after their object IDs are verified.
- GitHub publication requires the authenticated repository owner and remote CI
  verification.
- npm publication remains separate and requires authenticated `@cutout` scope
  authorization; this environment is not assumed to be authenticated.
- External deployment remains separate and requires a configured target host,
  persistent volume, HTTPS endpoint, and credentials.

## Release procedure

```text
git commit -m "Polish Cutout signing workflow UI"
git tag -a v0.1.2 -m "Cutout v0.1.2"
```

Verify with `git rev-parse v0.1.2^{commit}` and
`git rev-parse v0.1.2^{tag}`. Do not move or rewrite `v0.1.0` or `v0.1.1`.
