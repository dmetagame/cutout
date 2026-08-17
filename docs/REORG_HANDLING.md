# Reorg handling

Cutout treats canonicality uncertainty as an availability failure, never as a
privacy result.

## Detection

Before every incremental sync, the indexer re-fetches the stored cursor block.
A hash mismatch means the indexed tip is no longer canonical. Parent-link
divergence while extending a range, a changed range-head hash, or conflicting
persisted block provenance also stops publication.

The indexer remains `SYNCING` or `REORGING` throughout recovery. The preflight
API returns `SNAPSHOT_UNAVAILABLE` or `INCONSISTENT_BLOCK_DATA`; it cannot return
`LOW` or `ALLOW`.

## Recovery inside the retained window

The database retains a dense trailing window of 2,048 canonical headers by
default. On a fork:

1. query the current canonical hashes for retained blocks;
2. choose the highest retained block whose hash still matches;
3. atomically delete later blocks, cascading later public events;
4. delete later batch and snapshot records;
5. reset the cursor to that common ancestor;
6. replay bounded ranges forward;
7. publish only after a fresh complete snapshot validates.

This is the latest common canonical ancestor within the retained dense window.

## Forks deeper than retained history

If no retained header matches, Cutout does not guess an ancestor. It clears the
public read model and deterministically replays from the immutable history
boundary. The API remains unavailable for the entire replay.

This is deliberately more expensive than accepting uncertain canonicality.

## Crash behavior

Range event rows and cursor advancement share one SQLite transaction. A crash
before commit leaves neither; a crash after commit leaves both. If a process
stops between ranges, state remains `SYNCING` and the next process resumes from
the committed cursor. No partially indexed range can become active.

## Schema changes are not reorgs

A pool class-hash change is `POOL_SCHEMA_MISMATCH`, not a fork to recover. A new
ABI must be reviewed and explicitly versioned before indexing can resume.

## Replay fixture

The `reorg` branch in `fixtures/indexer/replay.json` forks after block
`8,978,975`. The test suite proves rollback removes the old branch event and
replaces it with the new branch event before publishing a new snapshot hash.
