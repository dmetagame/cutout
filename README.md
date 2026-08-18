# Cutout

**Cutout is a wallet-native signing guard that uses deterministic public STRK20
evidence to help users avoid predictable deposit amounts before they sign.**

Before a user signs a shield transaction, Cutout checks whether the proposed
token and exact amount have meaningful public cohort cover. If the user has
explicitly allowed amount flexibility, Cutout can recommend the smallest
permitted amount change that reaches a healthier public cohort. Cutout can
recommend, but it cannot sign.

Cutout is not a privacy guarantee. It does not claim anonymity, untraceability,
unlinkability, or a probability of deanonymization.

Built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon),
14 to 31 August 2026.

## The problem

STRK20 protects private state inside the protocol, but deposits and withdrawals
remain public at the edges. Exact amounts can therefore become operational
fingerprints even when the cryptography is sound.

Cutout's reproducible [pool census](docs/CENSUS.md) found that the median
proposed shield had only three prior same-token, exact-amount deposits in the
trailing 24 hours. Thirty-five percent had no prior exact match. Pool traffic
exists, but it is fragmented across amounts and does not automatically become
cover for the amount a user is about to sign.

## Why Starknet and STRK20

STRK20 makes the wallet signing boundary programmable through the Starknet
Wallet API while keeping the pool's deposit events and block provenance
publicly verifiable. Cutout uses those Starknet-native boundaries directly:
public RPC data for evidence, WalletAccountV6 for simulation and submission,
and an independently queried receipt for post-transaction verification.

No Cutout contract is required. The public evidence and recommendation logic
are deterministic offchain checks, while Ready X remains the only component
that can request a signature and submit the STRK20 action.

## How Cutout works

```text
typed shield intent
    -> canonical public STRK20 snapshot
    -> deterministic CUTOUT-v1.3 evaluation
    -> GUARD_POLICY-v1 decision and evidence
    -> optional in-bounds amount recommendation
    -> final exact-amount preflight
    -> wallet simulation
    -> explicit user confirmation
    -> wallet-owned submission
    -> independent public receipt verification
```

The only supported transaction action is one typed deposit:

```json
{
  "type": "deposit",
  "token": "0x...",
  "amount": "0x..."
}
```

Transfer, withdraw, mixed actions, arbitrary invoke calldata, stale evidence,
corrupt snapshots, wrong-network wallets, and unsupported tokens fail closed.

## Architecture

```text
Starknet RPC primary/secondary
           |
           v
supervised incremental indexer
           |
           v
persistent canonical SQLite read model
           |
           v
POST /api/preflight -> CUTOUT-v1.3 -> GUARD_POLICY-v1
           ^
           |
Next.js signing client <-> Ready X / WalletAccountV6
```

The indexer stores only public `Deposit` and `ViewingKeySet` observations plus
block, cursor, and replay provenance. Snapshots are complete, canonicalized,
hashable, freshness-checked, and withdrawn during reorg or schema uncertainty.

The browser owns user intent and signing state. The backend cannot sign or
broadcast. Ready X remains the only signing authority.

See the submission-ready system diagram in
[ARCHITECTURE.md](docs/ARCHITECTURE.md).

## CUTOUT-v1.3

`CUTOUT-v1.3` is a frozen deterministic model. The same intent and canonical
snapshot produce the same band, signals, cohort evidence, recommendation, and
decision ID. It does not use an LLM.

It reports public candidate-cohort evidence under the passive-public-observer
threat model in [THREAT_MODEL.md](docs/THREAT_MODEL.md). A candidate cohort is
not an anonymity set, and private wallet, exchange, or RPC telemetry can give an
adversary more information than Cutout observes.

Operational policy is separately frozen in [GUARD_POLICY.md](docs/GUARD_POLICY.md):

| CUTOUT band | Guard decision |
|---|---|
| `HIGH` | `DENY` |
| `MEDIUM` | `WARN` |
| `LOW` | `ALLOW` |

## Mainnet evidence

Milestone 3 completed one explicitly authorized Ready X mainnet transaction.
This is historical evidence, not a Milestone 5 smoke transaction.

| Item | Verified value |
|---|---|
| Action | one `0.01 STRK` STRK20 deposit |
| Transaction | `0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e` |
| Status | `SUCCEEDED / ACCEPTED_ON_L2` |
| Block | `13,427,531` |
| Preflight snapshot | `0xbe131fcf5f63309e40b8e3656465e56bac7f5b8a1b8d5336974071bfabc34acf` |
| Receipt artifact | `0x09adfe7664898666360052a35a9e3551e1c343c14fff37ea6d6fafb9046d643c` |

Reproduce the full public receipt binding through an independent RPC:

```bash
npm run verify:milestone3-receipt
```

The v0.1.1 release verification separately used Ready X `5.33.8`, Wallet API
`0.10.3`, and fresh mainnet snapshot
`0x494e624cf0afd9ba4d2abd52ab61ded11f597052ec782cc42836b7cde54e1cb8`
at block `13,448,562`. One `0.01 STRK` deposit was prepared with
`wallet_strk20PrepareInvoke(..., simulate: true)` and reached
`READY_FOR_CONFIRMATION`. No confirmation, invoke/broadcast method,
transaction hash, or transaction submission occurred.

The v0.1.2 patch is presentation-only. It improves the Propose -> Verify ->
Review -> Sign hierarchy, evidence disclosure, receipt presentation, responsive
layout, focus states, and reduced-motion behavior. It does not change the
engine, policies, API, indexer, guard, receipt verifier, or wallet execution
boundary, and it submits no new transaction.

## Wallet-native security boundary

- Cutout never receives private keys, seed phrases, viewing keys, private
  notes, proof secrets, or shielded balances.
- The API and indexer are read-only with respect to blockchain execution.
- `strk20PrepareInvoke(actions, true)` is used before confirmation.
- `strk20InvokeTransaction(actions)` exists only in the isolated browser wallet
  adapter and requires final validation plus explicit user approval.
- Receipt verification uses a public RPC independently of the signing wallet.
- Application telemetry omits raw account addresses and requested amounts.

See [SECURITY.md](docs/SECURITY.md) and
[RELEASE_AUDIT.md](docs/RELEASE_AUDIT.md).

## Integrator package

`packages/guard` builds `@cutout/guard@0.1.2`. Its single root
export contains only stable action, preflight, guard, amount, version, and
public receipt interfaces. It does not export wallet submission, the indexer,
SQLite, RPC ingestion, or operational runtime modules.

```bash
npm run package:verify
npm pack --workspace @cutout/guard
```

```ts
import {
  CUTOUT_MAINNET,
  createGuardedDepositPlan,
  requestPreflight,
  validateSingleDepositAction,
  verifyDepositReceipt,
} from "@cutout/guard";
```

The isolated TypeScript consumer is in
[`examples/guard-consumer`](examples/guard-consumer).
The reviewed API and versioning contract are in
[INTEGRATOR.md](docs/INTEGRATOR.md).

## Deployment

The hackathon deployment is two processes on one persistent host: one supervised
indexer writer and one read-only Next.js/API process sharing a SQLite volume.
Primary and secondary RPCs are explicitly configured and cross-checked.

```bash
cp .env.example .env
docker compose up --build -d
curl --fail-with-body http://127.0.0.1:3000/api/health
```

The repository has passed production-like local deployment verification. No
external target host is currently recorded, so this repository does not claim
that a public deployment is live. See [DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Testing

```bash
npm ci
npm run ci:verify
npm run test:milestone5
CUTOUT_ENV_FILE=.env.example docker compose config --quiet
```

Live public-data smoke, with no wallet call and no submission:

```bash
CUTOUT_DB_PATH=data/cutout-mainnet.sqlite npm run indexer:once
CUTOUT_DB_PATH=data/cutout-mainnet.sqlite npm run smoke:mainnet
```

The command must end with `NO TRANSACTION WAS SUBMITTED.`

## Current limitations

- One reviewed STRK20 mainnet pool and four configured tokens.
- One supported action: shield/deposit.
- SQLite assumes one persistent host and one indexer writer.
- Public RPC cross-checking reduces provider failure modes but is not a claim of
  decentralized or malicious-provider-proof infrastructure.
- Cutout does not protect against private wallet, exchange, browser, or RPC
  telemetry outside the published threat model.
- Registry publication and external deployment are separate release actions;
  neither is inferred from a tested Git tag or local container.

## Documentation

- [Threat model](docs/THREAT_MODEL.md)
- [Indexer](docs/INDEXER.md)
- [Snapshot](docs/SNAPSHOT.md)
- [Preflight API](docs/PREFLIGHT_API.md)
- [Signing workflow](docs/SIGNING_WORKFLOW.md)
- [Receipts](docs/RECEIPTS.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Operations](docs/OPERATIONS.md)
- [Judge demo](docs/DEMO_RUNBOOK.md)
- [Integrator API](docs/INTEGRATOR.md)
- [Architecture artifact](docs/ARCHITECTURE.md)
- [Final security review](docs/FINAL_SECURITY_REVIEW.md)
- [Release evidence](docs/RELEASE_EVIDENCE.md)
- [Release manifest](docs/RELEASE_MANIFEST.md)
- [Hackathon submission package](submission/README.md)

Apache-2.0. Nothing here is an audit or a privacy guarantee.
