# Judge demo runbook

This runbook separates live mainnet observation, wallet simulation, historical
receipt evidence, and deterministic fixture replay. Never describe one mode as
another.

## Prerequisites

- Node.js `22.22.0` and `npm ci` completed.
- Ready X `5.33.8` installed, unlocked, and connected to Starknet Mainnet.
- Two configured Starknet mainnet RPC URLs.
- No seed phrase, private key, viewing key, note, or proof entered into Cutout.

## 2-3 minute judge script

| Time | Presenter action and language |
|---|---|
| 0:00-0:20 | "Cutout is a wallet-native signing guard. It checks public exact-amount STRK20 cover before the user signs. It can recommend, but it cannot sign." |
| 0:20-0:45 | Show `/api/health`, the current block/hash, source age, index lag, and snapshot hash. State that stale or uncertain evidence stops the flow. |
| 0:45-1:15 | Enter one deposit amount, run preflight, and expand the deterministic CUTOUT-v1.3 signals and candidate cohort. Do not promise a particular band. |
| 1:15-1:35 | If a permitted recommendation exists, compare it with the original and select one. Otherwise show `NO_SAFER_EXECUTION`. Emphasize that the user controls the bounds. |
| 1:35-2:00 | Show the mandatory final exact-amount preflight, then the exact token, amount, account, pool, network, snapshot, and policy versions. |
| 2:00-2:20 | Run simulation if Ready X is available. Stop at `READY_FOR_CONFIRMATION`; do not invoke or submit during the release demo rehearsal. |
| 2:20-2:45 | Run the independent receipt replay for the historical Milestone 3 transaction and show account/pool/token/amount binding. |
| 2:45-3:00 | Close with: "Cutout reports public evidence under a published threat model. It does not claim anonymity or access private STRK20 state." |

If live RPC or wallet access fails, say `REPLAY / FIXTURE MODE` before using the
fallback. Never blur a replay, simulation, and historical transaction into one
live execution claim.

## A. Healthy live snapshot

Advance the persistent canonical read model:

```bash
CUTOUT_DB_PATH=data/cutout-mainnet.sqlite npm run indexer:once
```

Expected final shape:

```text
"event":"indexer_sync"
"status":"COMPLETE"
"observedBlock":<current block>
"snapshotHash":"0x..."
```

If the command returns `RPC_UNAVAILABLE`, `INCONSISTENT_BLOCK_DATA`,
`POOL_SCHEMA_MISMATCH`, or another error, stop the live demo. Do not reuse an
old snapshot as current.

## B-D. Live preflight and evidence

Run the non-submitting production API smoke immediately after the indexer:

```bash
CUTOUT_DB_PATH=data/cutout-mainnet.sqlite npm run smoke:mainnet
```

Expected markers:

```text
CUTOUT_M5_LIVE_SMOKE
"mode":"LIVE_MAINNET_NON_SUBMITTING"
"status":"PASS"
"model":"CUTOUT-v1.3"
"guardPolicy":"GUARD_POLICY-v1"
"freshnessPolicy":"FRESHNESS_POLICY-v1"
"sourceComplete":true
"transactionSubmitted":false
NO TRANSACTION WAS SUBMITTED.
```

Show the snapshot block/hash/timestamp, RPC head, source age, index lag, snapshot
hash, signal evidence, cohort counts, deterministic decision ID, decision, and
recommendation/refusal. The exact band is data-dependent. Do not promise
`LOW / ALLOW` in advance.

## E-F. Ready X simulation and confirmation boundary

Start the application against the same database:

```bash
npm run web:build
CUTOUT_DB_PATH=data/cutout-mainnet.sqlite \
  npm run web:start -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000` and:

1. Connect Ready X and verify Wallet API `0.10.3+` and Starknet Mainnet.
2. Select one supported token and enter a deliberately small amount.
3. Set exact or explicit user-controlled minimum/maximum bounds.
4. Run the initial Cutout check and show evidence.
5. Select the original or deterministic recommendation.
6. Observe the mandatory final exact-amount preflight.
7. Review token, base-unit amount, account, pool, network, decision, snapshot,
   model, and guard policy.
8. Click `Simulate in wallet` and approve only Ready X's simulation/proof prompt.
9. Stop when Cutout displays `Wallet confirmation` and `Confirm in wallet`.

At that checkpoint the expected wallet request is
`wallet_strk20PrepareInvoke` with `simulate: true`. There must be no
`wallet_strk20InvokeTransaction`, transaction hash, or submitted transaction.
Simulation is not permission to submit.

## G. Historical receipt verification

Use the already completed Milestone 3 transaction as historical evidence:

```bash
npm run verify:milestone3-receipt
```

Expected markers:

```text
"status":"VERIFIED"
"source":"PUBLIC_RPC"
"historicalMilestone":3
"receiptId":"0x09adfe...6d643c"
"walletMethodInvoked":false
"transactionSubmitted":false
```

Verified historical values:

| Item | Value |
|---|---|
| Transaction | `0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e` |
| Action | one `0.01 STRK` deposit |
| Block | `13,427,531` |
| Snapshot | `0xbe131fcf5f63309e40b8e3656465e56bac7f5b8a1b8d5336974071bfabc34acf` |
| Receipt | `0x09adfe7664898666360052a35a9e3551e1c343c14fff37ea6d6fafb9046d643c` |

This command verifies public inclusion and exactly one expected pool `Deposit`
event bound to the reviewed account, pool, token, and amount. It does not submit
or reuse the transaction.

## H. Fail-closed demonstration

Run deterministic browser failure cases:

```bash
npm run test:e2e -- --grep "wrong-network|simulation failure"
```

Expected result: both tests pass, no prepare call on wrong network, no invoke
call in either case, and no success state.

For backend/data failures:

```bash
npm run test:milestone2
npm run test:milestone4
```

Point judges to stale snapshot, corrupt snapshot, reorg, RPC disagreement,
schema mismatch, restart, and failover cases. Fixture tests prove deterministic
failure behavior; they are not live-mainnet observations.

## Replay fallback

If RPC or Ready X is unavailable, state clearly:

> REPLAY / FIXTURE MODE. No live wallet signature or mainnet transaction occurs.

Then run:

```bash
npm run test:e2e -- --headed --grep "recommended deposit"
```

The harness exercises initial/final preflight, deterministic recommendation,
simulation, and the hard stop before broadcast. It must report zero invoke
calls.

## Presenter language

Say "public exact-amount candidate cohort," "evidence observed at block," and
"CUTOUT-v1.3 band." Do not claim anonymity, untraceability, guaranteed
unlinkability, a privacy probability, deanonymization, or protection against
private wallet/RPC/exchange telemetry.
