# Cutout v0.1.1 Release Manifest

**Prepared:** 2026-08-17
**Release identity:** `v0.1.1`; after release, the commit resolved by the
annotated tag is authoritative.

## Identity

| Field | Value |
|---|---|
| Prior immutable release | `v0.1.0` / `ac0516e2114134c8aa878de032c958a9b94bb6ee` |
| Parent commit before patch | `ac0516e2114134c8aa878de032c958a9b94bb6ee` |
| Repository tag | `v0.1.1` |
| Package | `@cutout/guard@0.1.1` |
| Package API | `CUTOUT_GUARD_API-v1` |
| Engine | `CUTOUT-v1.3` |
| Guard policy | `GUARD_POLICY-v1` |
| Freshness policy | `FRESHNESS_POLICY-v1` |
| Receipt schema | `CUTOUT_RECEIPT-v1` |
| Network | Starknet Mainnet (`0x534e5f4d41494e`) |
| Pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

The existing `v0.1.0` tag and GitHub release are unchanged. The v0.1.1 commit
is intentionally identified by its annotated tag rather than embedded in this
file, because changing a file to contain its own commit hash changes that hash.
Resolve it with `git rev-parse v0.1.1^{commit}` after tagging.

## Patch scope

v0.1.1 fixes one Ready X browser timing defect. The server/bootstrap clock
offset is memoized per bootstrap response instead of being recalculated on each
React render. This keeps a final preflight current when the user spends more
than five seconds reviewing or selecting an amount. A delayed E2E regression
proves that the final intent timestamp advances.

No CUTOUT-v1.3 rule, frozen policy, indexer behavior, action shape, wallet
authority, receipt verification rule, or transaction path changed.

## Fresh non-submitting simulation

This is v0.1.1 verification evidence. It is separate from the historical
Milestone 3 submitted transaction.

| Field | Value |
|---|---|
| Browser/wallet | Chrome 151 / Ready X `5.33.8` |
| Wallet API | `0.10.3` |
| Chain | Starknet Mainnet (`0x534e5f4d41494e`) |
| Account | `0x05854e275d709627eb88a95519326c528f8c5dc402d350d29e72dbcaf48b434f` |
| Action | One `0.01 STRK` deposit (`0x2386f26fc10000`) |
| Observed/indexed block | `13,448,562` |
| Observed/indexed hash | `0x5a5eeec148606b872fdba346240d47e4473a65b824d048736cf7d984699ee50` |
| Observed/indexed timestamp | `1786991235` |
| RPC head block | `13,448,576` |
| RPC head hash | `0x6f4200bca38350b442499991c60b5c7f2098a282083318371315a39a871e3a8` |
| RPC head timestamp | `1786991258` |
| Snapshot hash | `0x494e624cf0afd9ba4d2abd52ab61ded11f597052ec782cc42836b7cde54e1cb8` |
| Index lag | `23 seconds` |
| Source age at final preflight | `54 seconds` |
| Decision | `LOW / ALLOW` |
| Decision ID | `0x9635829c45c3bf5ef1208049e984b0373be7fd3598f14e348a737007b2dab29e` |
| Wallet method | `wallet_strk20PrepareInvoke`, `simulate: true` |
| Final state | `READY_FOR_CONFIRMATION` |
| Invoke/broadcast method | Not called |
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

This transaction is historical evidence only. No transaction was confirmed or
submitted during v0.1.1 verification.

## Verification record

| Check | Result |
|---|---|
| Root regression suite | `135 passed, 0 failed` |
| Milestone 4 focused suite | `18 passed, 0 failed` |
| Milestone 5 focused suite | `5 passed, 0 failed` |
| Package public API suite | `3 passed, 0 failed` |
| Packed consumer install/typecheck/run | Passed |
| Browser E2E | `7 passed, 0 failed` |
| Root/web typechecks | Passed |
| Next.js production build | Passed |
| `git diff --check` | Passed |

## Patch commit file set

Ignored local state such as `data/`, `dist/`, `.next/`, `node_modules/`,
Playwright output, `.env`, `.npmrc`, package tarballs, logs, screenshots, and
browser profiles is excluded.

```text
README.md
apps/web/app/_components/signing-workflow.tsx
apps/web/e2e/signing-workflow.spec.ts
docs/FINAL_SECURITY_REVIEW.md
docs/INTEGRATOR.md
docs/MILESTONE5.md
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

- GitHub commit, tag, release, and remote CI are completed only after their
  identities are verified from the remote.
- npm publication remains separate and requires authenticated `@cutout` scope
  authorization.
- External deployment remains separate and requires a configured target host,
  persistent volume, HTTPS endpoint, and credentials.

## Release procedure

```text
git commit -m "Prepare Cutout v0.1.1 patch release"
git tag -a v0.1.1 -m "Cutout v0.1.1"
```

Verify with `git rev-parse v0.1.1^{commit}` and
`git rev-parse v0.1.1^{tag}`. Do not move or rewrite `v0.1.0`.
