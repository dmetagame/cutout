# Cutout release evidence

**Candidate date:** 2026-08-19

## Identity

| Item | Value |
|---|---|
| Repository release | `v0.1.3`; the commit resolved by the annotated tag is authoritative |
| Prior patch release | `v0.1.2` / `e9595295314932aad20d9f04933ade1e3ee212bc` |
| Prior immutable release | `v0.1.1` / `72cc32d3637af589486eda28c1dee2cdba7f3474` |
| Earlier immutable release | `v0.1.0` / `ac0516e2114134c8aa878de032c958a9b94bb6ee` |
| Parent before patch | `e9595295314932aad20d9f04933ade1e3ee212bc` |
| Package | `@cutout/guard@0.1.3` |
| Package API | `CUTOUT_GUARD_API-v1` |
| Engine | `CUTOUT-v1.3` |
| Guard policy | `GUARD_POLICY-v1` |
| Freshness policy | `FRESHNESS_POLICY-v1` |
| Receipt schema | `CUTOUT_RECEIPT-v1` |
| Network | Starknet Mainnet / `0x534e5f4d41494e` |
| Pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Reviewed pool class | `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d` |

Configured tokens are USDC, STRK, ETH, and strkBTC at the addresses exported by
`CUTOUT_MAINNET`.

## v0.1.3 patch scope

The release is a narrow presentation/integrity patch on top of v0.1.2. It
validates the exact structure of session-stored receipt artifacts and
recomputes the existing deterministic receipt ID before rendering verified
evidence. It also adds focused receipt E2E coverage and current deployment/demo
documentation.

The exact application/test source files are:

```text
apps/web/app/_components/receipt-view.tsx
apps/web/e2e/receipt-view.spec.ts
```

No CUTOUT-v1.3 rule, GUARD_POLICY-v1 rule, FRESHNESS_POLICY-v1 rule, API
contract, indexer behavior, database schema, independent receipt verification,
wallet adapter, or transaction semantics changed. No new wallet confirmation
or Starknet transaction was performed for this patch.

## v0.1.2 presentation patch scope

The prior release improved the Propose -> Verify -> Review -> Sign rail,
evidence hierarchy, loading and fail-closed presentation, recommendation
comparison, final-review disclosure, receipt presentation, responsive layout,
visible focus treatment, and reduced-motion behavior. Its exact UI source files
were `signing-workflow.tsx`, `receipt-view.tsx`, and `globals.css`; those
historical changes remain part of the v0.1.3 baseline.

## v0.1.1 patch scope

The patch fixes a browser timing defect without changing the engine, policies,
indexer, action shape, wallet authority, or submission boundary. The bootstrap
clock offset is now stable for the lifetime of a bootstrap response, allowing a
delayed final amount choice to generate a current final-preflight timestamp.
An E2E regression waits longer than the API's five-second timestamp tolerance
and proves that the final intent timestamp advances.

## v0.1.0 live public-data smoke

This was a new non-submitting smoke, distinct from the Milestone 3 transaction.

| Item | Observed value |
|---|---|
| Mode | `LIVE_MAINNET_NON_SUBMITTING` |
| Status | `PASS` |
| Token sampled | STRK `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| Observed/indexed block | `13,442,541` |
| Observed block hash | `0xdcecc6452f265d6d556b299e76bac17b2f0dc71121824063b92c9b44ce0766` |
| Observed/indexed timestamp | `1786981090` |
| RPC head block | `13,442,555` |
| RPC head hash | `0x5192f7745e72d9ab7bf27ea65358fa2ad5a10eb2387c2e85210b1ae138e732c` |
| RPC head timestamp | `1786981113` |
| Index lag | `23 seconds` |
| Source age | `97 seconds` |
| Snapshot | `0xf39aafdf488e51701a0531f6ef39a899f96d8b166b2439ee632ba60dec32cecb` |
| Decision | `LOW / ALLOW` |
| Decision ID | `0x4120452d92d03142a467cf89ceef28ac4d10016f6a604576b404a1584eaad085` |
| Recommendation | `NO_SAFER_EXECUTION` because the smoke intent was exact |
| Broadcast invoked | No |
| Transaction hash produced | No |
| Transaction submitted | No |

The CLI did not claim browser wallet capability or simulation; those are
verified only through the browser path.

Before this successful run, the retained snapshot was over the frozen
120-second source-age limit and was reported as `STALE_SNAPSHOT`. Two transient
primary-provider ingestion attempts returned `RPC_UNAVAILABLE` and failed
closed. A subsequent supervised sync published no partial snapshot and became
complete only after both configured providers passed chain and common-block
checks.

The following evidence is retained from v0.1.1 and is not a new v0.1.3 smoke:

## Verified v0.1.1 live browser simulation

This used the installed Ready X wallet and stopped before the Cutout submission
button.

| Item | Observed value |
|---|---|
| Browser | Chrome 151 through the approved local CDP context |
| Wallet | Ready X `5.33.8` |
| Wallet API | `0.10.3` |
| Network | Starknet Mainnet |
| Account | `0x05854e275d709627eb88a95519326c528f8c5dc402d350d29e72dbcaf48b434f` |
| Action | one `0.01 STRK` deposit / `0x2386f26fc10000` |
| Snapshot block | `13,448,562` |
| Snapshot | `0x494e624cf0afd9ba4d2abd52ab61ded11f597052ec782cc42836b7cde54e1cb8` |
| RPC head block | `13,448,576` |
| Source age at final preflight | `54 seconds` |
| Index lag | `23 seconds` |
| Final decision | `LOW / ALLOW` |
| Decision ID | `0x9635829c45c3bf5ef1208049e984b0373be7fd3598f14e348a737007b2dab29e` |
| Simulation | `apply_actions`, 16 calldata felts, completed |
| Final UI state | `READY_FOR_CONFIRMATION` |
| Broadcast request | Not observed |
| Transaction hash | Not produced |
| Transaction submitted | No |

Captured wallet request types were `wallet_supportedWalletApi`,
`wallet_requestAccounts`, two chain-ID checks, and
`wallet_strk20PrepareInvoke` with `simulate: true`. No
`wallet_strk20InvokeTransaction` request occurred. The visible Cutout
`Confirm in wallet` control was not activated.

## Historical Milestone 3 execution evidence

| Item | Value |
|---|---|
| Transaction | `0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e` |
| Action | one `0.01 STRK` deposit |
| Status | `SUCCEEDED / ACCEPTED_ON_L2` |
| Block | `13,427,531` |
| Snapshot | `0xbe131fcf5f63309e40b8e3656465e56bac7f5b8a1b8d5336974071bfabc34acf` |
| Receipt artifact | `0x09adfe7664898666360052a35a9e3551e1c343c14fff37ea6d6fafb9046d643c` |

`npm run verify:milestone3-receipt` reproduced the artifact from an independent
public RPC without invoking a wallet or submitting a transaction.

## Build, tests, and deployment

| Verification | Result |
|---|---|
| Root regression suite | `135 passed, 0 failed` |
| Milestone 4 focused suite | `18 passed, 0 failed` |
| Milestone 5 focused suite | `5 passed, 0 failed` |
| Package public-API suite | `3 passed, 0 failed` |
| Browser E2E suite | `9 passed, 0 failed` |
| Root and web TypeScript checks | passed |
| Next.js production build | passed |
| Packed-tarball consumer install/typecheck/run | passed |
| Package dry run | `34 files`, `17,653 bytes` |
| Prior v0.1.1 Docker image evidence | `sha256:21386c74b373176f1c45472bf90aad87493a997976f9b808a331379e6950845b` |
| Container runtime | UID `1000(node)`, all capabilities dropped, `no-new-privileges:true` |
| Production dependency inspection | TypeScript/Playwright absent; Next/React runtime present |
| Compose validation | passed |
| SQLite integrity and API mode | `ok`; read-only/query-only API connection |
| Persisted snapshot restart test | exact snapshot hash preserved across API restart |
| Health/preflight rehearsal | stale snapshot `503`; fresh sync `200`; deterministic `LOW / ALLOW` |
| Dependency audit | `0 vulnerabilities` |
| Diff whitespace check | passed |
| Historical receipt replay | passed through independent public RPC |
| v0.1.2 visual fixture harness | passed |
| v0.1.2 390px overflow check | passed |
| v0.1.2 reduced-motion check | passed |
| v0.1.2 security boundary smoke | `connectCalls=1`, `prepareCalls=1`, `invokeCalls=0` |
| v0.1.3 receipt mutation rejection | passed |
| v0.1.3 receipt mobile overflow, explorer, and focus checks | passed |

## v0.1.3 production verification

| Item | Observed value |
|---|---|
| Verification timestamp | `2026-08-19T18:23:43Z` |
| Deployment URL | `https://cutout.rouma.online` |
| Deployed release | `v0.1.3` |
| Deployed commit | `79c4843a32be58fcda5613d9f2a1d1b9157cc0ba` |
| GitHub release | `https://github.com/dmetagame/cutout/releases/tag/v0.1.3` |
| HTTPS / redirect | valid HTTPS; HTTP returns `308` to HTTPS |
| Health | HTTP `200`, `HEALTHY`, `ready: true` |
| Snapshot | `CURRENT_COMPLETE_SNAPSHOT`, block `13,507,736` |
| Snapshot hash | `0x6882ed209f767598bf68c7848e7fc333748fee1fe17ff549591816818fbaa14b` |
| Source age / index lag | `35s` / `22s` at health observation |
| Preflight | exact `0.01 STRK`, `AVAILABLE / ALLOW / LOW` |
| Decision ID | `0x4f883d819251014c9c395380a537b08f456026008d5c616284c160c10ec9c0c6` |
| Wallet simulation | `connectCalls=1`, `prepareCalls=1`, `invokeCalls=0` |
| Transaction state | no hash, confirmation, broadcast, or submission |

The production restart briefly failed closed with `503 / STALE_SNAPSHOT /
SNAPSHOT_UNAVAILABLE` while the indexer re-established a stable complete range,
then recovered. No uncertain snapshot produced `ALLOW`.

The endpoint uses the existing persistent SQLite volume, one supervised indexer
writer, a read-only API process, and HTTPS termination. Public port `3000` was
not externally reachable during verification. The container runtime remained
unprivileged with all capabilities dropped and `no-new-privileges` enabled.

This evidence does not claim npm registry publication. That remains a separate
owner-controlled action and must not be inferred from the repository tag,
deployment, or tested package tarball.

## Security review

See [RELEASE_AUDIT.md](RELEASE_AUDIT.md). No private STRK20 state was introduced,
and no v0.1.3 transaction was submitted. The historical Milestone 3 transaction
is retained separately above.

The exact release identity, evidence, and commit file set are
recorded in [RELEASE_MANIFEST.md](RELEASE_MANIFEST.md).
