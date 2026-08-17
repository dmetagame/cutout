# Canonical public snapshot

`PublicSnapshot` is the immutable boundary between the public-data layer and
the unchanged `CUTOUT-v1.3` engine.

## Contents

Every complete snapshot contains:

- chain ID, pool address, reviewed class hash, and ABI fixture version;
- observed/indexed-through block number, hash, and exact timestamp;
- RPC head number, hash, and exact timestamp;
- immutable source boundary and requested history boundary;
- completion declarations for pages and required selectors;
- retained block/hash/parent/timestamp references;
- normalized `Deposit` observations;
- normalized `ViewingKeySet` registration observations;
- engine and `FRESHNESS_POLICY-v1` versions.

Index lag is derived exactly as:

```text
rpcHeadTimestamp - indexedThroughTimestamp
```

It is returned in the API freshness metadata and is never estimated from block
count or assumed block time.

## Construction

The indexer builds a snapshot only after all target ranges commit. It then:

1. re-fetches and verifies the indexed cursor;
2. verifies the cursor parent link;
3. reads and verifies the current RPC head and its parent;
4. rechecks the pool class hash;
5. reads normalized observations from one canonical database state;
6. adds every required event and boundary block reference;
7. validates the snapshot with the frozen Milestone 1 integrity and freshness
   implementation;
8. persists the canonical JSON and activates it atomically.

Any failure leaves the indexer outside `COMPLETE`; the API cannot use the
candidate snapshot.

## Canonical hashing

The hash is SHA-256 over canonical JSON:

- object keys sort lexicographically;
- undefined fields are omitted;
- bigints serialize as base-10 strings;
- selectors sort lexicographically;
- block references sort by block number;
- observations sort by block, event ordinal, then event identity.

Therefore database row order, RPC page boundaries, and RPC response ordering do
not affect the hash. The stored hash is recomputed on every load. A mismatch is
`INDEX_CORRUPT` and cannot reach the engine.

## Completeness

The source boundary is fixed at or before the initial requested 30-day model
horizon plus the configured safety buffer. It is never moved forward during
incremental operation. A request for an earlier horizon triggers a complete
replay rather than silently claiming missing history.

## Retention

Milestone 2 retains public observations from the immutable source boundary
forward. It does not yet prune older public rows. Retention compaction is a
post-hackathon concern because deleting source evidence would complicate replay
and does not improve the core demo.
