# @cutout/guard integrator contract

**Package:** `@cutout/guard@0.1.0`
**API:** `CUTOUT_GUARD_API-v1`

The repository release is identified by `v0.1.0`. Until registry publication is
independently verified, integrators should use the tested workspace build or
packed tarball and must not infer that `npm install @cutout/guard@0.1.0` is
available publicly.

The package is a pure integration boundary around the frozen Cutout signing
workflow. It does not discover wallets, submit transactions, index Starknet,
open SQLite, or run the CUTOUT engine independently of the canonical API.

## Runtime exports

| Export | Responsibility |
|---|---|
| `CUTOUT_MAINNET` | Reviewed chain, pool, deployment block, and supported token metadata. |
| `CUTOUT_VERSIONS` | Package API, engine, guard, freshness, and receipt schema versions. |
| `requestPreflight` | Call the single fail-closed `POST /api/preflight` contract. |
| `parsePreflightApiResponse` | Reject malformed or availability/status-inconsistent responses. |
| `validateSingleDepositAction` | Accept exactly one typed STRK20 deposit and reject broader action shapes. |
| `makeFinalExactIntent` | Bind a selected amount to a new exact final-preflight intent. |
| `createGuardedDepositPlan` | Validate initial/final evidence, versions, bounds, wallet identity, displayed amount, and final action. |
| `validateSimulationEvidence` | Bind successful `apply_actions` simulation evidence to the guarded plan. |
| `authorizeSubmission` | Require matching simulation, fresh evidence, warning acknowledgement when needed, and explicit user approval. |
| `assertGuardedDepositPlan` / `assertSubmissionAuthorization` | Recheck serialized or retained guard state before a wallet boundary. |
| `verifyDepositReceipt` | Verify public inclusion and exact account/pool/token/amount event binding. |
| amount helpers | Exact decimal/base-unit conversion without floating-point arithmetic. |

The package also exports the corresponding TypeScript request, response,
action, plan, simulation, authorization, and receipt types.

## Deliberately absent

There is no supported package export for:

- `WalletAccountV6`, wallet discovery, or wallet submission;
- `strk20InvokeTransaction` or arbitrary calldata;
- the deterministic engine evaluator;
- raw RPC ingestion, event decoding, indexer, reorg, or failover internals;
- SQLite/read-model access;
- private keys, viewing keys, private notes, proofs, or shielded balances.

Node package `exports` exposes only `.`. Deep paths are implementation details
and are not part of the compatibility contract.

## Integration order

```text
typed WireShieldIntent
    -> requestPreflight
    -> user selects original/recommendation
    -> makeFinalExactIntent
    -> requestPreflight again
    -> createGuardedDepositPlan
    -> integrator-owned wallet simulation
    -> validateSimulationEvidence
    -> explicit user approval
    -> authorizeSubmission
    -> integrator-owned wallet call
    -> independent public receipt lookup
    -> verifyDepositReceipt
```

The integrator must never call its wallet submission method unless every prior
step succeeds. The package intentionally cannot submit by itself.

## Verification

```bash
npm run package:test
npm run package:consumer
npm pack --workspace @cutout/guard --dry-run
```

The consumer test installs the packed tarball into an isolated temporary
project, typechecks the example with no repository path aliases, and runs it.

## Versioning

- Any breaking export/signature change increments `CUTOUT_GUARD_API-v1`.
- Engine, guard, freshness, and receipt versions remain independent and are
  checked at runtime.
- A package release must not silently reinterpret an older snapshot or receipt.
- Registry publication and release tagging are repository-owner actions; a
  tested local tarball is not evidence of publication.
