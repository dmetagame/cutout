# Preflight API

Milestone 2 exposes exactly one application endpoint:

```text
POST /api/preflight
```

It reads the latest `COMPLETE` canonical snapshot, validates it with the frozen
Milestone 1 rules, runs the configured named Cutout model, and applies
`GUARD_POLICY-v1`. The deployed v0.2.0 service is configured for
`CUTOUT-v1.4` deposit and typed withdrawal analysis, with `CUTOUT-v1.3`
available for replay. It also exposes aggregate cover evidence from the same
canonical snapshot.

## Request

The body is the Milestone 1 typed shield intent. Because JSON numbers cannot
safely represent u128 values, amount fields are canonical positive decimal
base-unit strings.

```json
{
  "action": "shield",
  "chainId": "0x534e5f4d41494e",
  "account": "0x123",
  "token": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  "amount": "1000000000000000000",
  "evaluationBlock": 13387121,
  "evaluationTimestamp": 1786888342,
  "flexibility": {
    "mode": "flexible",
    "min": "980000000000000000",
    "max": "1020000000000000000"
  },
  "deadline": 1786891942
}
```

The v1.3 replay contract accepts only `action: "shield"`. The v1.4 release
accepts either a typed `shield` intent or a typed `withdraw` intent. A
withdrawal includes a `recipient` field and is analysis-only in the browser;
it has no wallet action construction or submission route. Extra fields, JSON
numeric amounts, unsupported tokens, invalid bounds, malformed addresses, and
mismatched chain or evaluation blocks fail closed in both versions.

The server also checks that `evaluationTimestamp` is current within five
seconds of its own clock. A client cannot backdate the request to make a stale
snapshot pass `FRESHNESS_POLICY-v1`.

The service is bound to the configured reviewed STRK20 pool. It does not accept
an arbitrary per-request pool address.

Example v1.4 withdrawal shape:

```json
{
  "action": "withdraw",
  "chainId": "0x534e5f4d41494e",
  "account": "0x123",
  "recipient": "0x456",
  "token": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  "amount": "1000000000000000000",
  "evaluationBlock": 13387121,
  "evaluationTimestamp": 1786888342,
  "flexibility": { "mode": "exact" },
  "deadline": 1786891942
}
```

## Successful response

```json
{
  "status": "AVAILABLE",
  "modelVersion": "CUTOUT-v1.3",
  "guardPolicyVersion": "GUARD_POLICY-v1",
  "decision": "WARN",
  "riskBand": "MEDIUM",
  "signals": [],
  "candidateCohort": {
    "existingMatches": 2,
    "projectedCohort": 3
  },
  "cohortQuality": {},
  "recommendation": null,
  "freshness": {
    "policyVersion": "FRESHNESS_POLICY-v1",
    "sourceAgeSeconds": 14,
    "indexLagSeconds": 9
  },
  "snapshotHash": "0x...",
  "decisionId": "0x...",
  "nonClaims": []
}
```

The response carries evidence, not generated prose. Recommendation amounts are
also decimal base-unit strings. In v1.4, a recommendation can additionally be
`WAIT` with a bounded `suggestedHorizonSeconds`; it never schedules a later
operation.

The v1.4 response also carries the same aggregate cohort quality fields for a
withdrawal as for a deposit. S2 and S3 are only meaningful on the withdrawal
path, and the response remains evidence-only.

## Deterministic decision ID

`decisionId` is SHA-256 over canonicalized model version, guard version,
snapshot hash, normalized intent, decision, band, signals, cohort evidence, and
recommendation. Repeating the same request against the same logical snapshot
produces the same response and decision ID.

## Fail-closed response

Operational uncertainty never includes `decision` or `riskBand`:

```json
{
  "status": "NO_CONFIDENT_RECOMMENDATION",
  "modelVersion": "CUTOUT-v1.3",
  "guardPolicyVersion": "GUARD_POLICY-v1",
  "error": {
    "code": "INDEX_LAG",
    "message": "Public source trails RPC head by more than 120 seconds."
  },
  "snapshotHash": "0x...",
  "decisionId": "0x...",
  "nonClaims": []
}
```

Public error codes are:

- `INVALID_INTENT`
- `UNSUPPORTED_ACTION`
- `UNSUPPORTED_TOKEN`
- `UNKNOWN_POOL`
- `RPC_UNAVAILABLE`
- `STALE_RPC`
- `INDEX_LAG`
- `INDEX_CORRUPT`
- `INCONSISTENT_BLOCK_DATA`
- `INSUFFICIENT_HISTORY`
- `MODEL_VERSION_MISMATCH`
- `POOL_SCHEMA_MISMATCH`
- `SNAPSHOT_UNAVAILABLE`

Invalid requests return HTTP 400, canonical/schema conflicts return HTTP 409,
and unavailable/stale data returns HTTP 503. Successful evidence returns 200.
When the indexer is in an unsafe recovery state, the API returns its persisted
operational code and does not serve a previously complete snapshot. During
ordinary forward catch-up or a transient provider error, a still-current
complete snapshot may remain active; freshness is still checked at request
time. Neither path maps uncertainty to `LOW / ALLOW`.

## Running

```bash
CUTOUT_DB_PATH=data/cutout.sqlite npm run api:preflight
```

The server binds to `127.0.0.1:8787` by default. `PORT` may override the port.

## Telemetry boundary

Structured request logs contain only status, decision ID, snapshot hash,
decision/band or error code, and latency. Raw account addresses and requested
amounts are never logged. The backend has no wallet, signing, or transaction
submission capability.
