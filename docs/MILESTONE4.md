# Milestone 4: Mainnet deployment and operational hardening

**Status:** COMPLETE. Production-like fixture deployment verified on 2026-08-17.

Milestone 4 packages the frozen Milestone 1-3 behavior as a durable two-process
deployment. It adds operational reliability only; it does not add a product
feature, scoring rule, transaction type, signing path, or private-data path.

## Implemented architecture

```text
Ready X <-> browser signing-decision client
                  |
                  v
        Next.js preflight/health API (read-only)
                  |
                  v
        persistent SQLite canonical read model
                  ^
                  |
       supervised incremental indexer
          /                    \
 primary Starknet RPC   secondary Starknet RPC
```

The indexer is the only writer and the only raw-RPC normalization component.
The API opens SQLite read-only. The browser remains the only owner of user
intent and signing state; Ready X remains the only signing authority.

## Operational additions

- SQLite schema v2 with last sync/error/block/timing state, provider state,
  RPC failure/failover counters, and schema v1 migration.
- WAL, `synchronous=FULL`, atomic range/cursor commits, read-only API mode,
  integrity checks, latest persisted snapshot recovery, and online backup.
- Primary/secondary RPC probing, timeout, chain-ID validation, common-block
  cross-check, whole-attempt failover, and runtime-failure suppression.
- Long-running indexer supervision with bounded exponential backoff,
  interruptible graceful shutdown, and restart from the persisted cursor.
- `GET /api/health` with indexer, database, provider, freshness, snapshot,
  version, and aggregate metric state.
- Dockerfile, Docker Compose persistent volume, production commands, environment
  template, CI workflow, and backup command.
- Deterministic operational/recovery fixtures and Milestone 4 tests.

## Persistence decision

SQLite remains the smallest reliable deployment for one writer and one local
read-only API. PostgreSQL was considered and deferred because this milestone
does not require distributed writers or cross-host database failover. The
schema and deterministic snapshot boundary remain portable if that requirement
changes later.

## Safe operational states

The external state is one of `HEALTHY`, `DEGRADED`, `UNAVAILABLE`,
`REORG_RECOVERY`, or `SCHEMA_MISMATCH`. Snapshot state is independently
`CURRENT_COMPLETE_SNAPSHOT`, `STALE_SNAPSHOT`, or `NO_USABLE_SNAPSHOT`.

Only a current complete snapshot may reach preflight. An older hash-valid
snapshot may remain stored for backup/diagnosis but is withdrawn from serving
during sync uncertainty, outage, reorg, corruption, or schema mismatch.

## CI contract

CI installs the pinned Node runtime and dependencies, then runs:

```text
npm run check
npm run test:milestone4
npm run typecheck
npm run web:typecheck
npm run web:build
npx playwright install --with-deps chromium
npm run test:e2e
npm audit --omit=dev --audit-level=high
git diff --check HEAD^ HEAD
```

CI uses deterministic fixture mode and cannot submit a blockchain transaction.
Real mainnet execution remains an explicitly controlled manual procedure.

## Frozen contracts preserved

- `CUTOUT-v1.3` scoring is unchanged.
- `FRESHNESS_POLICY-v1` remains the only freshness policy.
- `GUARD_POLICY-v1` remains `HIGH -> DENY`, `MEDIUM -> WARN`, `LOW -> ALLOW`.
- Wallet API `0.10.3`, `WalletAccountV6`, simulation, and single typed deposit
  behavior are unchanged.
- The backend cannot sign or broadcast.
- No private STRK20 state is indexed, logged, or persisted.

## Existing mainnet execution evidence

No new transaction is required for Milestone 4. The controlled Milestone 3
transaction remains the execution-path proof:

- transaction `0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e`;
- one `0.01 STRK` deposit;
- `SUCCEEDED / ACCEPTED_ON_L2` at block `13,427,531`;
- snapshot `0xbe131fcf5f63309e40b8e3656465e56bac7f5b8a1b8d5336974071bfabc34acf`;
- receipt artifact `0x09adfe7664898666360052a35a9e3551e1c343c14fff37ea6d6fafb9046d643c`.

It is historical evidence, not a Milestone 4 transaction.

## Verification record

| Check | Result |
|---|---|
| Full Node regression suite | 130 passed, 0 failed |
| Milestone 4 focused suite | 18 passed, 0 failed |
| Browser E2E | 6 passed, 0 failed |
| Root and web TypeScript checks | passed |
| Next.js production build | passed |
| Docker Compose config | valid with the documented environment file |
| API/indexer container build | passed |
| Unprivileged container smoke test | UID 1000; shared SQLite volume writable for WAL/SHM; API connection read-only/query-only |
| Production dependency audit | 0 vulnerabilities at high-or-greater threshold |
| Diff whitespace check | passed |

The production-like rehearsal used the real compiled indexer, a deterministic
public JSON-RPC replay, the persistent SQLite read model, and `next start`:

- initial provider `primary`, health `HEALTHY`, readiness true;
- primary outage selected `secondary` for the next complete attempt;
- health became `DEGRADED` but remained ready with a current snapshot;
- API restart preserved snapshot
  `0x69135926d26bdef09ae6bf13aa65aacfbbcdedd8924b39b1c41c7340a1ad913e`;
- snapshot hash remained identical across failover, indexer restart, API
  restart, and primary recovery;
- recovery selected `primary` and restored `HEALTHY`;
- online SQLite backup completed;
- production preflight returned deterministic `MEDIUM / WARN` from that same
  snapshot.

This was explicitly fixture/replay verification, not a current-mainnet claim.
No wallet method ran and no transaction was submitted.

## Residual operational limits

- SQLite deployment availability depends on one persistent host/volume and one
  writer. It is not cross-region failover.
- API preflight metrics are process-local and reset with the API process.
- Wallet simulation and receipt failures are intentionally not sent to a
  backend telemetry endpoint.
- Node 22 reports `node:sqlite` as experimental even though the pinned runtime,
  persistence, migration, backup, and restart paths are covered by tests.

See [DEPLOYMENT.md](DEPLOYMENT.md), [OPERATIONS.md](OPERATIONS.md),
[HEALTH.md](HEALTH.md), [SECURITY.md](SECURITY.md), and
[DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).
