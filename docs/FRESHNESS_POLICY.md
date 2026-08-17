# FRESHNESS_POLICY-v1

**Version 1. Frozen 2026-08-14 for the mainnet shield-preflight spike.**

This is an operational data-availability policy. It determines whether Cutout
has enough current, internally consistent public Starknet data to run
CUTOUT-v1.3. It does not change the privacy/evidence model, its signals, or its
bands.

## Fixed limits

| Requirement | Limit |
|---|---:|
| Maximum source age | 120 seconds |
| Maximum index lag | 120 seconds |

Source age is `evaluation timestamp - source-through timestamp`. Index lag is
`RPC head timestamp - source-through timestamp`. Both are measured from exact
accepted block timestamps, never an assumed block time.

The RPC head block must be greater than or equal to the indexed/source-through
block. A source that claims a block ahead of the RPC head is inconsistent.

## Required consistency

A usable snapshot must satisfy all of the following:

1. The observed, source-through, RPC-head, and source-parent blocks have valid
   block numbers, hashes, and timestamps.
2. Re-fetching a referenced block by number yields the same block hash retained
   in the snapshot.
3. Every observation's block hash matches the independently fetched hash for
   its block number.
4. The source-through header's `parent_hash` equals the independently fetched
   hash of `source-through block - 1`. Any longer adjacent header sequence that
   is supplied must maintain this parent link at every step.
5. Block numbers and timestamps are monotonic across each verified adjacent
   parent link.
6. The RPC head must not be behind the source-through head in block number or
   timestamp.
7. The observed block must not be ahead of either the source-through block or
   the RPC head, and its retained hash must match the corresponding source/head
   hash when the block numbers are equal.

Hash comparison is case-insensitive after canonical felt normalization. A
missing hash is a failure, not a zero value.

## Required source completeness

For a shield preflight, the public source range must begin at or before the
CUTOUT-v1.3 observation horizon and end at the declared source-through block.
All non-overlapping RPC ranges in that interval must have completed, every
continuation token must have been exhausted, and both ABI-reviewed event types
must have been queried:

- `Deposit`
- `ViewingKeySet`

Every returned event of either requested selector must decode successfully.
Every event-bearing block must have exact block metadata and a matching event
block hash. Unknown selectors, malformed event shapes, partial pages, skipped
ranges, or an unverified pool ABI make the source incomplete.

The source range may contain no matching events and still be complete, provided
the complete required interval was queried successfully. Missing evidence may
never be inferred from a partial range.

## Failure behavior

If freshness, consistency, parent continuity, ABI identity, or completeness
cannot be established, Cutout returns `NO_CONFIDENT_RECOMMENDATION` with an
explicit operational error. It does not run the evidence model and does not
return a risk band or `ALLOW` decision.

Clock uncertainty, an unavailable RPC, a pre-confirmed block without a stable
hash, or inability to retrieve any required header also fails closed.
