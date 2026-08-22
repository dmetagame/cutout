# Cutout demo scripts

## Two-minute judge demo

**0:00-0:15 - Positioning**

"Cutout is a wallet-native signing guard. Before a STRK20 deposit is signed, it
checks whether that exact public amount has meaningful cohort cover. It can
recommend, but it cannot sign."

**0:15-0:35 - Fresh evidence**

Open `https://cutout.rouma.online`, then `/api/health`. Show the mainnet chain,
reviewed pool, indexed block and hash, source age, index lag, and snapshot hash.
Explain that stale, partial, or inconsistent data makes evidence unavailable.

**0:35-1:00 - Preflight**

Enter one supported token and amount. Run Cutout. Expand the CUTOUT-v1.4
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

## Five-minute judge demo

**0:00-0:20 - Problem**

Show the application, not a slide. "STRK20 protects private state, but deposits
are public at the edge. A distinctive exact amount can still stand out before
it enters the shielded pool."

**0:20-0:45 - What Cutout is**

Point to the first-screen statement and the Propose -> Verify -> Review ->
Simulate -> User Wallet rail. "Cutout is a deterministic signing guard. It
checks current public pool conditions before the wallet is asked to simulate
the exact action."

**0:45-1:15 - Propose a shield**

Connect the wallet, confirm Starknet Mainnet, choose STRK, and enter `0.01`.
State the permitted amount range if flexibility is enabled. Point out that no
wallet signing or transaction request has occurred.

**1:15-1:45 - Show fresh public evidence**

Run Cutout. Show the observed block, snapshot hash, source age, index lag, and
`CUTOUT-v1.4` / `GUARD_POLICY-v1` / `FRESHNESS_POLICY-v1`. Open
`https://cutout.rouma.online/api/health` only briefly if the judge wants the raw
operational record.

**1:45-2:15 - Explain the deterministic decision**

Show PASS/BLOCKED, the risk band, exact-amount cohort, fired signals, and the
decision ID. If an alternative exists, show that it stays inside the user's
range and preserves the token and deposit action. Do not promise a particular
live recommendation.

**2:15-2:45 - Exact-action review**

Choose the proposed or recommended amount. Show the mandatory second exact
preflight and read the amount-first review: one deposit, token, amount, account,
pool, network, snapshot, model, and policy. Expand the base-unit action only if
the judge asks.

**2:45-3:15 - Wallet simulation and signing boundary**

Click "Simulate in wallet". Stop at `READY_FOR_CONFIRMATION`. Point to the exact
token, amount, pool, account, and simulation result. "This is a preview. Cutout
cannot sign or broadcast. Control moves to the user's wallet only if the user
chooses Confirm in wallet." Do not click confirmation.

**3:15-3:45 - Receipt architecture and historical proof**

Show the historical Milestone 3 transaction on Starkscan or run
`npm run verify:milestone3-receipt`. Explain that this was one previously
authorized `0.01 STRK` deposit, not today's demo transaction. Show the verified
block, exact Deposit event binding, receipt ID, and explorer navigation.

**3:45-4:15 - Security and fail-closed behavior**

Explain that stale, partial, corrupt, reorg-uncertain, or provider-inconsistent
state produces evidence unavailable, never `ALLOW`. Mention the observed
production synchronization race: Cutout stopped, then recovered only after a
stable complete snapshot was available.

**4:15-4:45 - Architecture and why it matters**

Trace the visible path: public Starknet data -> supervised indexer -> canonical
snapshot -> deterministic preflight -> evidence review -> user wallet -> public
receipt verification. Emphasize that the backend has no signer or private-key
path.

**4:45-5:00 - Closing pitch**

"Cutout adds a precise safety check at the moment of user authority. It is
deterministic, inspectable, fail-closed, and non-custodial: better evidence
before signing, without pretending to guarantee anonymity or control the
wallet."

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

## CUTOUT-v1.4 depth path

Announce: "This is the v1.4 public-edge analysis path. Any replay data is
labeled as replay; the demo remains non-submitting and wallet-controlled."

1. Start on the wallet-free Public cover ledger. Point to the selected token's
   trailing exact-amount cohorts, unmatched-event share, address diversity,
   active days, burst share, snapshot block/hash, and model identity.
2. Switch the analysis selector from Deposit to Withdraw. Explain that
   withdrawals are the second public STRK20 edge and that this path evaluates
   exact counterpart and timing evidence without creating a wallet action.
3. Run the typed withdrawal analysis. Show S2, S3, S7, the cohort quality, and
   a deterministic `WAIT`, `CHANGE_AMOUNT`, or `NO_SAFER_EXECUTION` result.
4. Select an in-bounds amount only if the user chooses it. Show the second
   evidence check, then stop at `ANALYSIS ONLY`.
5. Show the wallet fixture counters: withdrawal `prepareCalls=0` and
   `invokeCalls=0`. Return to the production deposit demo before showing
   `READY_FOR_CONFIRMATION` or the historical receipt.

The v1.4 extension demonstrates STRK20 integration depth; it does not authorize
or submit a transaction.
