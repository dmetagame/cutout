# Incremental public indexer

**Milestone:** 2
**Database schema:** `CUTOUT_INDEX_DB-v2`
**Consumed events:** `Deposit`, `ViewingKeySet`
**Private STRK20 state consumed:** none

The indexer is the only Cutout component allowed to translate raw Starknet RPC
responses into normalized public observations.

```text
Starknet RPC
    -> reviewed pool class hash and event selectors
    -> bounded event ranges and exhausted continuation tokens
    -> exact event-block headers
    -> deterministic event ordinals and normalization
    -> atomic SQLite batch commit
    -> canonical cursor
    -> complete PublicSnapshot
```

## Runtime

Milestone 2 uses SQLite through the declared Node 22 runtime. SQLite is appropriate
for the hackathon deployment because the workload has one writer, local
deterministic reads, and no need for distributed coordination. WAL mode,
`synchronous=FULL`, foreign keys, and `BEGIN IMMEDIATE` transactions are enabled.

PostgreSQL was not added. It would introduce deployment and migration work
without improving the single-writer correctness boundary being proven here.

Default paths and commands:

```bash
CUTOUT_DB_PATH=data/cutout.sqlite npm run indexer:once
CUTOUT_DB_PATH=data/cutout.sqlite npm run indexer:run
```

The continuous runner polls every 15 seconds by default. Override that with
`CUTOUT_INDEX_INTERVAL_SECONDS`.

Milestone 4 adds primary/secondary provider selection, bounded retry/backoff,
graceful shutdown, provider-health persistence, online backup, and a v1-to-v2
schema migration. Deployment details are in [DEPLOYMENT.md](DEPLOYMENT.md) and
recovery procedures are in [OPERATIONS.md](OPERATIONS.md).

## Read-model schema

### `indexer_state`

One singleton row holds:

- chain, pool, reviewed class hash, and ABI fixture identity;
- status: `EMPTY`, `SYNCING`, `REORGING`, `COMPLETE`, or `ERROR`;
- immutable source-history boundary;
- indexed-through block, hash, and timestamp;
- active complete snapshot hash;
- last operational error code and timestamp;
- last successful sync timestamp/block and sync/batch/snapshot durations;
- RPC failure/failover counters and active provider identity.

The API serves a snapshot only when this row is `COMPLETE` and its active
snapshot exists and hashes correctly. State and snapshot contents are loaded in
one SQLite read transaction, so a request cannot combine rows from two indexer
transitions.

### `canonical_blocks`

Stores block number, block hash, parent hash, exact timestamp, Starknet status,
and why the header was retained. It contains:

- source and range boundaries;
- every event-bearing block;
- snapshot head and parent boundaries;
- a dense trailing reorg window.

### `public_events`

Stores only normalized public observations and reproducibility metadata:

- event identity: block, transaction hash, deterministic transaction ordinal;
- selector, source pool, block hash, and timestamp;
- `Deposit`: depositor, token, amount in decimal base units;
- `ViewingKeySet`: registering account only;
- public field counts and sanitized raw provenance.

For `ViewingKeySet`, the public-key felt and encrypted-key payload values are
discarded before the database write. Only the account, selector, widths, source,
transaction, and block provenance remain.

### `ingestion_batches`

Records each atomically committed range, its boundary hashes, event/page counts,
and a deterministic batch identifier.

### `snapshots`

Stores canonical snapshot JSON keyed by its SHA-256 hash. The active snapshot is
switched in the same transaction that marks the indexer `COMPLETE`.

### `rpc_provider_state`

Stores aggregate operational state for the named primary and secondary
providers: health, last check/success, public chain/head provenance, and last
error code. Provider URLs and credentials are not stored.

## Cursor semantics

The cursor means every requested selector page from the immutable source
boundary through `indexed_through_block` completed and every returned event was
decoded and committed.

For each bounded range, events, retained headers, batch provenance, and the new
cursor commit in one transaction. A crash can leave the prior cursor or the new
cursor, never event rows with an older cursor. While a multi-range sync is in
progress the state is `SYNCING`, so the API fails closed instead of publishing a
partial backfill.

If a sync fails, the state becomes `ERROR` and retains the precise operational
failure code. The API surfaces that code, such as `RPC_UNAVAILABLE`,
`INDEX_LAG`, or `POOL_SCHEMA_MISMATCH`; it never falls back to an older active
snapshot.

## Event identity

Starknet `getEvents` does not expose a protocol event index. Cutout therefore
sorts retained events by canonical block, transaction hash, and normalized raw
event fingerprint, then assigns an ordinal within each transaction. Exact
duplicate shapes receive consecutive distinct ordinals. Reversing RPC page or
row order produces the same event set and snapshot hash.

## Pool schema protection

The class hash is checked at startup, at each committed range boundary, and at
snapshot publication. Any change from the reviewed ABI fixture returns
`POOL_SCHEMA_MISMATCH`. The indexer never attempts to reinterpret upgraded pool
events automatically.

## Privacy boundary

The indexer never requests or stores:

- viewing keys or their encrypted payload values;
- private notes;
- shielded balances;
- proof material;
- wallet keys, recovery phrases, or wallet history.

Progress logs contain block ranges, event counts, page counts, hashes, and
operational errors. They contain no preflight account or amount.

## Deterministic replay

`fixtures/indexer/replay.json` contains canonical and forked public RPC branches.
The replay suite exercises backfill, pagination, restart, incremental sync,
duplicate events, row-order changes, and reorg recovery:

```bash
npm run test:milestone2
```
