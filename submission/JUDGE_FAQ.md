# Judge FAQ

## What is Cutout?

A wallet-native guard for one STRK20 deposit. It evaluates public exact-amount
cohort evidence before signing and may recommend a healthier amount only inside
the user's permitted range.

## Is Cutout a mixer or privacy protocol?

No. STRK20 is the privacy protocol. Cutout is a signing-decision layer that
uses public STRK20 observations.

## Does LOW mean anonymous?

No. `LOW` is only a CUTOUT-v1.3 band under the published rules. Candidate
cohorts are not anonymity sets, and Cutout reports no probability of
deanonymization.

## Does Cutout access private notes or viewing keys?

No. It indexes only the public fact that a ViewingKeySet event occurred, not
the viewing key or encrypted payload. It never reads notes, proofs, private
balances, private keys, or seed phrases.

## Can the backend sign or submit?

No. The backend is public-data-only. WalletAccountV6 and the submission method
exist only in the browser wallet adapter. Ready X remains the signing authority.

## Why not put the router onchain?

The evidence calculation and recommendation do not need execution authority.
Keeping them offchain avoids adding a contract, state, upgrade surface, or a
new party that can modify the transaction. The wallet submits directly to the
reviewed STRK20 pool.

## How are recommendations constrained?

The user supplies target, minimum, and maximum. A recommendation must preserve
the token and deposit action, stay within bounds, improve the frozen cohort
metric, and pass a new exact preflight before simulation.

## What happens when data is stale or providers disagree?

Cutout returns evidence unavailable. It never maps operational uncertainty to
`LOW / ALLOW`.

## How are reorgs handled?

The indexer compares stored block hashes and parent links, rolls back to the
latest retained common ancestor, and deterministically replays. A deeper reorg
causes a full replay and temporary unavailability.

## Is there real mainnet evidence?

Yes. Milestone 3 submitted one explicitly authorized `0.01 STRK` deposit:
`0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e`.
The receipt was independently verified against the expected account, pool,
token, amount, and Deposit event.

## Did the final release smoke submit another transaction?

No. It used fresh mainnet public data and produced no wallet call, broadcast,
transaction hash, or submission.

## What is shipped for integrators?

`@cutout/guard@0.1.2` exposes the stable action, preflight, guard, amount,
version, and public receipt interfaces. It does not expose wallet submission,
the engine evaluator, RPC ingestion, the indexer, or SQLite.

## What remains operationally incomplete?

An external deployment requires a target host, persistent volume, HTTPS, and
post-deploy verification. Public npm availability requires owner credentials
and registry verification. Neither is inferred from the GitHub release.
