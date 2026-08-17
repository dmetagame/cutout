# Cutout release evidence

**Candidate date:** 2026-08-17

## Identity

| Item | Value |
|---|---|
| Repository release | `v0.1.0`; the commit resolved by the annotated tag is authoritative |
| Parent before release | `c10b8cf67761de92c30231477a2d460e2cb4ea9c` |
| Package | `@cutout/guard@0.1.0` |
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

## Milestone 5 live public-data smoke

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

## Verified Milestone 5 live browser simulation

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
| Snapshot block | `13,436,600` |
| Snapshot | `0xf58cf3aca5f33f9588593b0cfe38d48ae6ecd2097fc074fa8add13c63d666234` |
| Final decision | `LOW / ALLOW` |
| Decision ID | `0x55f252b7f31f8468ccd161e9dd66db16ffac12d2b4294b75194845fe7f3432d2` |
| Simulation | `apply_actions`, 16 calldata felts, completed |
| Final UI state | `READY FOR CONFIRMATION` |
| Broadcast request | Not observed |
| Transaction hash | Not produced |
| Transaction submitted | No |

Captured wallet request types were `wallet_supportedWalletApi`,
`wallet_requestAccounts`, two chain-ID checks, and
`wallet_strk20PrepareInvoke` with `simulate: true`. No
`wallet_strk20InvokeTransaction` request occurred.

During the final release-day smoke, the approved Chromium CDP endpoint did not
respond and was recorded as `BROWSER_CONTEXT_UNAVAILABLE`. No fresh wallet
request was made, no confirmation was requested, and the earlier verified
simulation above was not presented as a new browser run.

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
| Browser E2E suite | `6 passed, 0 failed` |
| Root and web TypeScript checks | passed |
| Next.js production build | passed |
| Packed-tarball consumer install/typecheck/run | passed |
| Package dry run | `34 files`, `17,652 bytes` |
| Docker image | `sha256:21386c74b373176f1c45472bf90aad87493a997976f9b808a331379e6950845b` |
| Container runtime | UID `1000(node)`, all capabilities dropped, `no-new-privileges:true` |
| Production dependency inspection | TypeScript/Playwright absent; Next/React runtime present |
| Compose validation | passed |
| SQLite integrity and API mode | `ok`; read-only/query-only API connection |
| Persisted snapshot restart test | exact snapshot hash preserved across API restart |
| Health/preflight rehearsal | stale snapshot `503`; fresh sync `200`; deterministic `LOW / ALLOW` |
| Dependency audit | `0 vulnerabilities` |
| Diff whitespace check | passed |
| Historical receipt replay | passed through independent public RPC |

Deployment status is `NOT DEPLOYED TO A TARGET HOST`. Docker/Compose remains a
production-like local deployment package until a real host, persistent volume,
HTTPS endpoint, health record, backup, restart, and rollback are verified.

This evidence does not claim an external target-host deployment or npm registry
publication. Those remain separately verifiable owner-controlled actions and
must not be inferred from the repository tag, local Docker verification, or
tested package tarball.

## Security review

See [RELEASE_AUDIT.md](RELEASE_AUDIT.md). No private STRK20 state was introduced,
and no Milestone 5 transaction was submitted.

The exact release identity, evidence, and commit file set are
recorded in [RELEASE_MANIFEST.md](RELEASE_MANIFEST.md).
