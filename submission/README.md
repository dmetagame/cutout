# Cutout hackathon submission package

## Project

Cutout is a wallet-native signing guard that uses deterministic public STRK20
evidence to help users avoid predictable deposit amounts before they sign.

## Problem

STRK20 protects private state inside the protocol, but deposits and withdrawals
remain public at the edges. A distinctive exact amount can therefore become an
operational fingerprint. Pool activity alone does not guarantee useful cover
for the exact amount a user is about to deposit.

## Solution

Cutout intercepts the signing decision, not the wallet. It reads a fresh,
canonical public STRK20 snapshot, runs the frozen `CUTOUT-v1.3` model, applies
`GUARD_POLICY-v1`, and shows the evidence behind the result. If the user has
explicitly allowed an amount range, the deterministic engine may recommend an
in-bounds amount with healthier public exact-amount cover. The selected amount
is preflighted again before wallet simulation.

Cutout can recommend, but it cannot sign.

## Release identity

| Item | Value |
|---|---|
| Repository | `https://github.com/dmetagame/cutout` |
| Release tag | `v0.1.1` |
| Prior release | `v0.1.0` / `ac0516e2114134c8aa878de032c958a9b94bb6ee` |
| Package source | `@cutout/guard@0.1.1` |
| Engine | `CUTOUT-v1.3` |
| Guard policy | `GUARD_POLICY-v1` |
| Freshness policy | `FRESHNESS_POLICY-v1` |
| Network | Starknet Mainnet |
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

The exact patch commit is the commit resolved by the annotated `v0.1.1` tag.
The existing `v0.1.0` tag and GitHub release remain unchanged.

## Architecture

```text
Public Starknet
    -> reviewed STRK20 events and block headers
    -> supervised incremental indexer
    -> canonical SQLite public read model
    -> complete deterministic PublicSnapshot
    -> POST /api/preflight
    -> CUTOUT-v1.3
    -> GUARD_POLICY-v1 evidence
    -> browser final review
    -> WalletAccountV6 simulation
    -> explicit user confirmation
    -> wallet-owned STRK20 submission
    -> independent public receipt verification
```

The full diagram and authority table are in
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

## Security model

- The backend and indexer cannot sign or broadcast.
- The wallet remains the only signing authority.
- Exactly one typed STRK20 `deposit` is supported.
- Arbitrary calldata, transfer, withdraw, invoke, and mixed actions fail closed.
- Stale, partial, corrupt, reorging, and schema-uncertain snapshots are
  unavailable, never converted to `LOW / ALLOW`.
- Cutout never receives private keys, seed phrases, viewing-key payloads,
  private notes, proofs, or shielded balances.
- Receipt success requires independent public binding of account, pool, token,
  amount, event, and included block.

See [`docs/FINAL_SECURITY_REVIEW.md`](../docs/FINAL_SECURITY_REVIEW.md) for the
adversarial matrix and residual risks.

## Real mainnet evidence

One explicitly authorized Milestone 3 transaction proved the execution and
receipt path:

| Item | Value |
|---|---|
| Transaction | `0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e` |
| Action | one `0.01 STRK` deposit |
| Status | `SUCCEEDED / ACCEPTED_ON_L2` |
| Block | `13,427,531` |
| Receipt artifact | `0x09adfe7664898666360052a35a9e3551e1c343c14fff37ea6d6fafb9046d643c` |

The v0.1.1 release smoke was a separate, non-submitting Ready X simulation on
fresh mainnet snapshot
`0x494e624cf0afd9ba4d2abd52ab61ded11f597052ec782cc42836b7cde54e1cb8`
at block `13,448,562`. It produced deterministic `LOW / ALLOW`, decision ID
`0x9635829c45c3bf5ef1208049e984b0373be7fd3598f14e348a737007b2dab29e`,
and reached `READY_FOR_CONFIRMATION` through
`wallet_strk20PrepareInvoke(..., simulate: true)`. No confirmation,
invoke/broadcast method, transaction hash, or submission occurred.

## Demo

- Reproducible command runbook: [`docs/DEMO_RUNBOOK.md`](../docs/DEMO_RUNBOOK.md)
- Timed presenter scripts: [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md)
- Judge questions: [`JUDGE_FAQ.md`](JUDGE_FAQ.md)
- Pitches: [`PITCH.md`](PITCH.md)

The live demo stops at the explicit confirmation boundary unless a separate
transaction is expressly authorized. The historical transaction above is used
to demonstrate independent receipt verification without creating another
mainnet transaction.

## Verification summary

| Suite | Result |
|---|---|
| Root regression | 135 passed |
| Milestone 4 focused | 18 passed |
| Milestone 5 focused | 5 passed |
| Package public API | 3 passed |
| Browser E2E | 7 passed |
| TypeScript and production build | passed |
| Packed consumer | passed |
| Docker/Compose validation | passed |
| Dependency audit | 0 vulnerabilities |

## External availability

- GitHub release: `https://github.com/dmetagame/cutout/releases/tag/v0.1.1`
- Deployment URL: not available until a target host, persistent volume, and
  HTTPS endpoint are configured and verified.
- npm URL: not available until repository-owner npm authentication and
  publication are completed and verified from the public registry.

These statuses are intentionally separate. A Git tag does not prove deployment
or npm publication.

## Known limitations and non-claims

- One reviewed STRK20 mainnet pool and four configured tokens.
- One supported action: deposit/shield.
- SQLite assumes one persistent host and one indexer writer.
- Public RPC cross-checking does not make the infrastructure decentralized or
  malicious-provider-proof.
- Cutout reports candidate cohorts under a passive-public-observer threat model.
- Cutout does not claim anonymity, untraceability, guaranteed unlinkability, a
  probability of deanonymization, or protection from private wallet, exchange,
  browser, or RPC telemetry.

## Hackathon submission copy

Cutout moves STRK20 privacy awareness into the moment that matters: before the
wallet signs. It turns public pool history into deterministic, reproducible
evidence about the user's exact deposit amount, can search only within
user-authorized flexibility, and binds the final choice to wallet simulation
and independent receipt verification. The result is a narrow Starknet-native
guard with a real mainnet execution, a publishable integrator boundary, and
explicit non-claims instead of a generic privacy score.
