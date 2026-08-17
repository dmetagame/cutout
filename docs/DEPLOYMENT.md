# Deployment

**Milestone:** 4
**Target:** hackathon/demo mainnet deployment package
**Execution authority:** browser wallet only

**Current external deployment status:** no target host has been configured or
verified. The repository has passed production-like local deployment checks;
it does not claim a public deployment is live.

Cutout deploys as two processes sharing one persistent public read model:

```text
Browser + Ready X
    -> Next.js signing-decision client
    -> POST /api/preflight and GET /api/health
    -> read-only SQLite connection
                              ^
                              |
Starknet RPC primary/secondary -> supervised indexer -> SQLite volume
```

The browser communicates with Ready X directly. The API and indexer contain no
wallet account, signing, or transaction-submission capability.

## Persistence decision

SQLite is retained for the hackathon deployment. The workload has one indexer
writer, small read-only API transactions, and no requirement for distributed
write coordination. The store uses WAL mode, `synchronous=FULL`, foreign keys,
atomic ingestion transactions, online backup, and deterministic restart
recovery.

PostgreSQL was considered. It would be appropriate when Cutout needs multiple
writers, horizontal read replicas, or managed cross-host failover. None of
those requirements exists in this milestone, so migration would add operational
risk without changing the correctness boundary.

Only one `indexer:run` process may write a database. The database, WAL, and SHM
files must live on the same persistent volume. The API opens SQLite with the
read-only flag and `PRAGMA query_only`. The volume itself remains writable to
the API container because WAL readers may need to create or update SQLite's
shared-memory sidecar. A filesystem read-only mount is incompatible with a
cold WAL reader when the `-shm` file does not yet exist.

## Runtime requirements

- Node.js `>=22.5.0 <23`; the container pins Node `22.22.0`.
- A persistent local filesystem or Docker volume for SQLite.
- Two independent Starknet mainnet JSON-RPC URLs.
- HTTPS termination at the deployment edge.
- No wallet secret, viewing key, note, proof, or private balance configuration.

## Configuration

`.env.example` is the complete template. Production values belong in an
untracked environment file or secret manager.

Compose defaults to `.env`; CI and validation may select another explicit file
with `CUTOUT_ENV_FILE`, for example:

```bash
CUTOUT_ENV_FILE=.env.example docker compose config --quiet
```

| Variable | Default/example | Purpose |
|---|---|---|
| `CHAIN_ID` | `0x534e5f4d41494e` | Frozen Starknet mainnet identity; any other value is rejected. |
| `POOL_ADDRESS` | `0x040337...ffe812a` | Frozen reviewed STRK20 pool; any other value is rejected. |
| `CUTOUT_RPC_PRIMARY_URL` | Lava public RPC | Preferred indexer provider. |
| `CUTOUT_RPC_SECONDARY_URL` | Cartridge public RPC | Validated failover and cross-check provider. |
| `CUTOUT_RPC_TIMEOUT_MS` | `12000` | Per-request transport timeout. |
| `CUTOUT_RETRY_INITIAL_MS` | `1000` | First supervisor retry delay. |
| `CUTOUT_RETRY_MAX_MS` | `30000` | Maximum exponential retry delay. |
| `CUTOUT_RPC_RANGE_BLOCKS` | `200000` | Provider range ceiling; runtime batches are also capped at 50,000 blocks. |
| `CUTOUT_INDEX_INTERVAL_SECONDS` | `15` | Delay between successful sync attempts. |
| `CUTOUT_DB_PATH` | `/var/lib/cutout/cutout.sqlite` | Persistent read-model path. |
| `CUTOUT_BROWSER_RPC_URL` | Lava public RPC | Public receipt-verification RPC exposed to the browser. |
| `PORT` | `3000` | Next.js HTTP port. |

Provider credentials embedded in URLs are server-only. Never prefix them with
`NEXT_PUBLIC_`. `CUTOUT_BROWSER_RPC_URL` must be treated as public by design and
must not contain a secret.

## Docker Compose deployment

The repository includes a deliberately small `compose.yaml`:

```bash
docker compose up --build -d
docker compose ps
curl --fail-with-body http://127.0.0.1:3000/api/health
```

The `indexer` is the only application-level database writer. Both containers
mount `cutout-data` so SQLite can coordinate WAL readers, while the API opens
the database with SQLite `readOnly` and `PRAGMA query_only`. Until the first
complete snapshot exists, health and preflight return unavailable rather than
serving partial or stale evidence.

Both containers run as the unprivileged Node user, drop Linux capabilities,
set `no-new-privileges`, and use an init process for signal forwarding. The
runtime image prunes development dependencies.

## Remaining host step

To claim an actual deployment, the repository owner must provide a target host
or platform with a persistent volume and HTTPS edge, configure the reviewed
environment, deploy the immutable candidate revision, and record live health,
restart, backup, and rollback evidence from that host. None of those host facts
can be inferred from local Docker verification.

Stop without deleting the persistent volume:

```bash
docker compose stop
```

`docker compose down -v` deletes the database volume and must not be used as a
normal restart procedure.

## Direct process deployment

Build once, then supervise the two commands independently with the host process
manager:

```bash
npm ci
npm run build
npm run web:build
CUTOUT_DB_PATH=/srv/cutout/cutout.sqlite npm run indexer:run
CUTOUT_DB_PATH=/srv/cutout/cutout.sqlite npm run web:start -- --hostname 0.0.0.0 --port 3000
```

Start the indexer first. Starting the API first is safe, but it remains
unready until a complete database is available.

## Backup and restore

Create an online, consistent SQLite backup without stopping the writer:

```bash
CUTOUT_DB_PATH=/srv/cutout/cutout.sqlite \
CUTOUT_BACKUP_PATH=/srv/cutout/backups/cutout-$(date +%Y%m%d-%H%M%S).sqlite \
npm run db:backup
```

The backup command refuses to overwrite an existing file. Verify a backup by
opening it read-only and checking `/api/health` or the SQLite `quick_check`.

To restore, stop both processes, retain the failed database files for forensic
inspection, place the selected backup at `CUTOUT_DB_PATH`, then start the
indexer before the API. Never copy only one of a live database, WAL, or SHM set.

## Application rollback

1. Stop API and indexer.
2. Preserve the current database and logs.
3. Restore the database backup taken before the deployment when the prior
   application expects an older schema.
4. Deploy the prior immutable image or revision.
5. Start the indexer and require a current complete snapshot.
6. Start the API and verify `/api/health` before opening the demo.

Schema v1 databases migrate forward to schema v2 in place. A code rollback is
not assumed to understand a newer schema, which is why the pre-deployment
backup is part of the rollback contract.

## Deployment alternatives considered

- **Single Next.js process running the indexer:** rejected because web process
  restarts and request lifetimes are not a durable scheduler.
- **Serverless API plus local SQLite:** rejected because the API and writer
  would not share a durable filesystem reliably.
- **Kubernetes:** rejected as unnecessary for two processes and one writer.
- **Managed PostgreSQL:** deferred until workload or availability requirements
  exceed a single persistent host.

See [OPERATIONS.md](OPERATIONS.md) for recovery procedures and
[SECURITY.md](SECURITY.md) for the deployment trust boundary.
