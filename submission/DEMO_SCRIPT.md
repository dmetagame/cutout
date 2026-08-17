# Cutout demo scripts

## Two-minute judge demo

**0:00-0:15 - Positioning**

"Cutout is a wallet-native signing guard. Before a STRK20 deposit is signed, it
checks whether that exact public amount has meaningful cohort cover. It can
recommend, but it cannot sign."

**0:15-0:35 - Fresh evidence**

Open `/api/health`. Show the mainnet chain, reviewed pool, indexed block and
hash, source age, index lag, and snapshot hash. Explain that stale, partial, or
inconsistent data makes evidence unavailable.

**0:35-1:00 - Preflight**

Enter one supported token and amount. Run Cutout. Expand the CUTOUT-v1.3
signals, exact-amount cohort, freshness, and non-claims. If a permitted
recommendation exists, compare it; otherwise show `NO_SAFER_EXECUTION`.

**1:00-1:25 - Final decision and wallet boundary**

Select the final amount. Show the mandatory second preflight and the exact
token, amount, account, pool, network, snapshot, model, and guard policy. Run
simulation only when Ready X is available. Stop at `READY_FOR_CONFIRMATION`.

**1:25-1:50 - Real execution evidence**

Run `npm run verify:milestone3-receipt`. Show that transaction
`0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e`
was included and independently bound to the expected account, pool, token, and
`0.01 STRK` amount.

**1:50-2:00 - Close**

"Cutout reports public evidence under a published threat model. It never sees
private notes or viewing keys, and the user remains the final signing authority."

## Five-minute technical demo

1. Show `GET /api/health` and identify both RPC providers, canonical cursor,
   source age, index lag, snapshot hash, and frozen versions.
2. Explain atomic batches, block parent/hash tracking, class-hash validation,
   reorg rollback/replay, and why partial state cannot become current.
3. Submit a typed deposit intent to `POST /api/preflight`; show deterministic
   signal evidence, cohort quality, recommendation/refusal, and decision ID.
4. Change only the permitted flexibility bounds and show that any recommendation
   remains the same action/token and within `min`/`max`.
5. Select the final amount and show the mandatory exact second preflight.
6. Connect Ready X if available; verify Wallet API 0.10.3+, mainnet, account,
   and one deposit action. Run `strk20PrepareInvoke(actions, true)` only.
7. Stop before `strk20InvokeTransaction`. Point out that the backend has no
   signing or submission capability.
8. Verify the historical Milestone 3 receipt through the independent public
   RPC command and show the deterministic receipt artifact.
9. Run the wrong-network and simulation-failure E2E cases to demonstrate that
   no wallet call or success state appears on failed validation.

## Exact commands

```bash
CUTOUT_DB_PATH=data/cutout-mainnet.sqlite npm run indexer:once
CUTOUT_DB_PATH=data/cutout-mainnet.sqlite npm run smoke:mainnet
npm run verify:milestone3-receipt
npm run test:e2e -- --grep "wrong-network|simulation failure"
```

If the live RPC or wallet is unavailable, announce `REPLAY / FIXTURE MODE`
before running the deterministic harness. Never describe fixture output as a
new mainnet transaction.
