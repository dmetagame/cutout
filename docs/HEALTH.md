# Health and readiness

Cutout exposes one operational endpoint:

```http
GET /api/health
```

It is a no-store, read-only endpoint. It reports service readiness and public
indexing provenance; it is not a dashboard and does not expose user activity.

## HTTP semantics

| HTTP | `status` | Meaning |
|---:|---|---|
| `200` | `HEALTHY` or `DEGRADED` | A current complete snapshot is available and the API may answer preflight. |
| `503` | `UNAVAILABLE`, `REORG_RECOVERY`, or `SCHEMA_MISMATCH` | Do not use the service for a signing decision. |

The response includes `ready: true` only for a current complete snapshot. A
`DEGRADED` provider state does not itself invalidate a snapshot; the preflight
path independently applies `FRESHNESS_POLICY-v1` and integrity checks.

## Response fields

The report contains:

- `api.status`: process-level API status;
- `indexer.status`: operational state, internal cursor state, indexed-through
  block, last successful sync/block, last error code/time, and active provider;
- `database`: active-path integrity result, check scope, and
  `read-only`/`read-write` mode;
- `rpc.primary` and `rpc.secondary`: status, last check/success, chain ID,
  head block/hash/timestamp, and last error code;
- `rpc.currentHead*`: the head represented by the currently inspected snapshot;
- `snapshot`: `CURRENT_COMPLETE_SNAPSHOT`, `STALE_SNAPSHOT`, or
  `NO_USABLE_SNAPSHOT`, with hash, block provenance, source age, and index lag;
- `versions`: the active model plus `FRESHNESS_POLICY-v1` and
  `GUARD_POLICY-v1`. Production v0.2.0 reports `CUTOUT-v1.4`; `CUTOUT-v1.3`
  remains available for model-matched replay.
- `metrics`: aggregate sync, RPC, index-lag, snapshot, and preflight timing
  counters.

Example shape (values are illustrative and intentionally not a live claim):

```json
{
  "status": "HEALTHY",
  "ready": true,
  "api": { "status": "HEALTHY" },
  "indexer": {
    "status": "HEALTHY",
    "internalStatus": "COMPLETE",
    "indexedThroughBlock": 13427531,
    "lastSuccessfulBlock": 13427531,
    "lastSuccessfulSync": 1787000000,
    "lastErrorCode": null,
    "activeRpcProvider": "primary"
  },
  "snapshot": {
    "status": "CURRENT_COMPLETE_SNAPSHOT",
    "snapshotHash": "0x...",
    "blockNumber": 13427531,
    "indexedThroughBlock": 13427531,
    "sourceAgeSeconds": 12,
    "indexLagSeconds": 4
  },
  "versions": {
    "model": "CUTOUT-v1.3",
    "freshnessPolicy": "FRESHNESS_POLICY-v1",
    "guardPolicy": "GUARD_POLICY-v1"
  }
}
```

The actual response may include more operational fields, but never private
wallet information, raw account telemetry, requested amounts, or provider
secrets.

During ordinary forward synchronization or a transient RPC failure, the
indexer may report `DEGRADED`/`SYNCING` while retaining a complete snapshot
whose source age and index lag remain inside policy. In that case `ready` may
remain true and preflight still performs its own request-time validation.
Unsafe recovery states such as reorg uncertainty, schema mismatch, corruption,
or expired freshness withdraw the snapshot and must remain fail-closed.

The current live v0.2.0 endpoint was rechecked at
`2026-08-23T11:08:49Z`: HTTP `200`, `HEALTHY`, `ready: true`,
`CURRENT_COMPLETE_SNAPSHOT`, block `13,738,142`, snapshot hash
`0x6aa680d9e86bd5b4e774c72d4e1e6a2f38d0e0e900dc8afe8e3a449143b308f1`,
source age `26s`, index lag `10s`, both configured RPC providers healthy, and
active-path database integrity `ok`. This is a time-bound operational sample,
not a permanent guarantee.

## Readiness rules

The health builder performs the checks needed to serve the active read path:
schema/state identity, active snapshot presence and hash, snapshot completeness,
block references, source age, and index lag. The response labels this scope as
`database.checkScope: ACTIVE_PATH`.

It deliberately does not run SQLite `PRAGMA quick_check` on every request. A
deep database scan can block the live read model as the event history grows and
belongs in the backup/operator procedure. The frozen freshness limits are:

- source age at most 120 seconds;
- index lag at most 120 seconds;
- RPC head not behind indexed/source head;
- consistent block and parent hashes;
- complete required selector pages and reviewed pool schema.

If any condition cannot be established, readiness is false. Health does not
override the preflight service: a preflight request still loads the active
snapshot and applies the same validation at request time.

## Monitoring procedure

Poll `/api/health` without caching. Alert when:

- HTTP status is `503`;
- `ready` changes from true to false;
- `indexer.status` becomes `REORG_RECOVERY` or `SCHEMA_MISMATCH`;
- `snapshot.status` is not `CURRENT_COMPLETE_SNAPSHOT`;
- `sourceAgeSeconds` or `indexLagSeconds` approaches the frozen 120-second
  limit;
- `lastSuccessfulSync` stops advancing while the RPC head advances.

Do not turn these alerts into automatic signing or automatic amount changes.

## Privacy boundary

Health is aggregate operational evidence. The server deliberately does not
collect wallet simulation/receipt rates from browser sessions because doing so
would require an additional telemetry channel. Browser failures are rendered
to the user and can be inspected during a controlled rehearsal without sending
account or amount identifiers to the backend.
