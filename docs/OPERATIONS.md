# Operations

Cutout's operational rule is the same as its data rule: uncertainty withdraws
the recommendation. An older persisted snapshot may remain available for
diagnosis and recovery, but preflight serves only the active, complete,
freshness-valid canonical snapshot.

## Indexer lifecycle

Each supervised attempt performs:

```text
probe primary and secondary RPC
    -> validate chain IDs and common canonical block
    -> select one provider for the entire attempt
    -> verify pool class hash
    -> detect/recover any reorg
    -> ingest bounded complete ranges atomically
    -> validate cursor/head/parent links
    -> build and hash one complete snapshot
    -> atomically publish the snapshot
```

Providers are never mixed inside one ingestion attempt. A runtime provider
failure aborts that attempt. The next attempt may select the validated
secondary.

`SIGINT` and `SIGTERM` stop the supervisor, interrupt an active poll/backoff
sleep, allow the current RPC/database operation to settle, and close SQLite.
The supervisor retries failures with bounded exponential backoff. A successful
sync resets the delay. There is no tight infinite retry loop.

## Health states

| State | Meaning | Serving behavior |
|---|---|---|
| `HEALTHY` | Current complete snapshot; both providers recently validated. | Preflight may serve after its own validation. |
| `DEGRADED` | Current complete snapshot exists, but provider redundancy is impaired. | Preflight may serve while frozen freshness checks still pass. |
| `UNAVAILABLE` | No usable current snapshot, database unavailable, or unrecoverable operational error. | Fail closed. |
| `REORG_RECOVERY` | Canonical rollback/replay is in progress. | Fail closed. |
| `SCHEMA_MISMATCH` | Pool class hash no longer matches the reviewed ABI. | Fail closed until a reviewed upgrade is deployed. |

See [HEALTH.md](HEALTH.md) for the endpoint contract.

## Restart procedure

1. Query `/api/health` and retain the response and recent structured logs.
2. Stop the indexer gracefully.
3. Leave the database, WAL, and SHM on the persistent volume.
4. Start exactly one indexer writer.
5. Wait for `CURRENT_COMPLETE_SNAPSHOT` and confirm the indexed block advances.
6. Restart the API if required; it opens the same database read-only per request.
7. Run one non-signing preflight and compare its snapshot hash with health.

The cursor, retained canonical headers, events, batches, snapshots, provider
health, and operational counters survive restart. A committed range is either
fully present with its cursor or absent.

## RPC outage and failover

Primary transport failure, invalid JSON/shape, wrong chain ID, or failed probe
marks the primary unavailable. If the secondary validates, the whole next sync
attempt uses it and increments the failover counter.

If both providers are healthy, Cutout compares block hash, parent hash, and
timestamp at their highest common block. Disagreement produces
`INCONSISTENT_BLOCK_DATA`; Cutout does not guess which provider is correct.

If both providers are unavailable, the indexer records `RPC_UNAVAILABLE`,
backs off, and keeps retrying. The API never labels the old snapshot current.
When either provider recovers, the next successful attempt validates
canonicality and publishes a new complete snapshot.

## Reorg recovery

A cursor hash mismatch enters `REORGING`. The indexer compares its dense retained
header window with the live provider, rolls back events, batches, headers, and
snapshots after the latest common ancestor in one transaction, then replays.

If no common ancestor exists inside the retained window, Cutout clears the
public read model and deterministically replays from the required history
boundary. During either path, no snapshot is active. See
[REORG_HANDLING.md](REORG_HANDLING.md).

## Failure runbooks

### `RPC_UNAVAILABLE`

- Check both provider states and last error codes in `/api/health`.
- Verify DNS/TLS/credentials outside Cutout without changing chain or pool.
- Restore at least one configured provider; do not point failover at another
  network.
- Require a new complete sync before resuming the demo.

### `INCONSISTENT_BLOCK_DATA`

- Preserve health output and logs.
- Stop repeated manual restarts; the disagreement may be an active fork or bad
  provider response.
- Compare the reported common block through an independent public provider.
- Resume only when configured providers agree and the indexer completes replay.

### `POOL_SCHEMA_MISMATCH`

- Stop the demo and retain the database.
- Confirm the onchain class hash and whether STRK20 migrated or upgraded.
- Review and version a new ABI in a separate milestone. Never reinterpret old
  rows automatically.

### Database unavailable or corrupt

- Stop API and indexer.
- Preserve the database, WAL, SHM, and logs.
- Run SQLite `quick_check` on a copy, not the only production files.
- Restore the latest verified backup if integrity cannot be established.
- Start the indexer and require deterministic replay/current health.

### Stale snapshot or index lag

- Treat the endpoint as unavailable; the frozen 120-second limits are not
  operator-adjustable policy knobs.
- Inspect RPC head timestamps, indexed-through timestamp, sync duration, and
  provider health.
- Restore sync and wait for a new complete snapshot. Never manually mark a
  stale snapshot complete.

### Corrupt cursor

- Preserve the database for diagnosis.
- Prefer restoring a verified backup followed by replay.
- If no backup exists, initialize a new database and perform a complete public
  replay. Do not edit cursor fields by hand.

## Logs and metrics

Indexer logs are structured JSON containing lifecycle event, range/block,
event/page counts, snapshot hash, error code, and aggregate timing. Preflight
logs contain status, decision/risk band or error code, snapshot hash, and
duration.

They do not contain raw account addresses, requested amounts, wallet history,
wallet secrets, viewing keys, notes, proof material, or private balances.

Persisted operational metrics include last sync/batch/snapshot duration, index
lag, RPC failure count, and RPC failover count. API preflight metrics are
process-local aggregates. Wallet simulation and receipt-verification events
remain in the browser signing session and are not sent to the server solely for
analytics.

## Backup cadence

Take an online backup before every deployment or schema migration and before a
demo rehearsal. For a hackathon deployment, retain at least the most recent
known-good backup and the pre-deployment backup. Test restoration against a
separate path; an untested backup is not a recovery guarantee.

## Fixture replay

Deterministic outage, pagination, restart, reorg, deep-reorg, corruption, and
fail-closed cases use `fixtures/indexer/replay.json`:

```bash
npm run test:milestone4
```

Fixture results are replay evidence, not live-mainnet observations.
