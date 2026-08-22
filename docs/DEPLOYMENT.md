# Deployment

**Milestone:** 4
**Target:** hackathon/demo mainnet deployment package
**Execution authority:** browser wallet only

**v0.2.0 deployment status:** pending the separate production smoke recorded
below.

Production endpoint: [`https://cutout.rouma.online`](https://cutout.rouma.online)

The endpoint is the production target for the `v0.2.0` application release
behind HTTPS termination. The deployment uses one supervised indexer writer
and one read-only Next.js/API process sharing a persistent SQLite volume. The
post-deployment record must confirm HTTP-to-HTTPS redirect behavior,
`GET /api/health` readiness, a current complete snapshot, a successful
non-submitting preflight, and no externally reachable application port `3000`.

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

## v0.2.0 production verification record

The current v0.2.0 deployment record is completed after the release host has
been rebuilt and the live smoke has passed. It must record the deployed commit,
model-matched snapshot, preflight evidence, browser smoke, and zero-invoke
wallet fixture. The historical v0.1.4 record follows unchanged.

| Check | Result |
|---|---|
| URL | `https://cutout.rouma.online` |
| Release | `v0.2.0` / deployed commit recorded after deployment |
| Engine | `CUTOUT-v1.4` |
| Wallet boundary | deposit simulation only; no confirmation or submission |

## Historical v0.1.4 production verification record

At the time of this historical record, production ran the annotated `v0.1.4`
release. The observations below deliberately separate a stable health sample,
the later live browser preflight, and transient synchronization states.

| Check | Result |
|---|---|
| URL | `https://cutout.rouma.online` |
| Release | `v0.1.4` / `315f61a1a55fa771337eb633ecd564b2097aee1a` |
| Annotated tag | `v0.1.4` / tag object `6c651d20cb3a2ab66f376521f0a11412c245fd9a` |
| GitHub release | `https://github.com/dmetagame/cutout/releases/tag/v0.1.4` |
| HTTPS / redirect | valid certificate; HTTP returns `308` to HTTPS |
| Stable health sample | HTTP `200`, `HEALTHY`, `ready: true`; complete snapshot at block `13,562,835` |
| Stable snapshot hash | `0x7c5800573aefb165033b06285610517ffe44cc6864a11f2d04af2e82feef6b12` |
| Stable freshness | source age `23s`, index lag `2s` |
| Browser smoke timestamp | `2026-08-20T00:40:15Z` |
| Preflight | exact `0.01 STRK`, `AVAILABLE / ALLOW / LOW` |
| Preflight block | `13,563,714` |
| Preflight snapshot hash | `0xc445314dcf3faf4db17205d762e805ae0960b9ac9adea4c998fd3383e7a7197c` |
| Preflight freshness | source age `19s`, index lag `3s`, complete source |
| Decision ID | `0x3199d68b4c25137a2076ce0b2fa644f1705344e3ed2ae62f598b19473811377d` |
| Browser UI smoke | 1440, 1024, 768, 430, and 390px; no overflow, console errors, or failed requests |
| Motion/accessibility | Lenis active, GSAP transitions/pinning active, reduced motion disables Lenis and preserves information/focus |
| Wallet boundary | simulation-only fixture: `connectCalls=1`, `prepareCalls=1`, `invokeCalls=0` |
| Transaction state | no hash, confirmation, broadcast, or submission |
| Runtime security | containers run as `node`, `CapDrop=ALL`, `no-new-privileges`, API database read-only |
| Public port `3000` | closed/filtered externally; only HTTPS is publicly reachable |

During the same operational window, RPC synchronization correctly produced
`DEGRADED`/`SYNCING` health observations and a `503 / SNAPSHOT_UNAVAILABLE`
sample. The API and UI exposed no decision or risk band from those uncertain
states. Once the canonical snapshot stabilized, health and preflight recovered.
This is the intended fail-closed behavior.

The production browser smoke was public-data-only plus a simulation-only wallet
harness. It stopped at `READY_FOR_CONFIRMATION` and did not confirm or submit a
wallet transaction. The historical Milestone 3 transaction remains separate
execution evidence.

## Historical v0.1.3 production verification

The following record is retained for release chronology and is not a claim
about the current deployment:

| Check | Result |
|---|---|
| URL | `https://cutout.rouma.online` |
| Verification timestamp | `2026-08-19T18:23:43Z` |
| Release | `v0.1.3` / `79c4843a32be58fcda5613d9f2a1d1b9157cc0ba` |
| GitHub release | `https://github.com/dmetagame/cutout/releases/tag/v0.1.3` |
| Health | HTTP `200`, `HEALTHY`, `ready: true` |
| Snapshot | `CURRENT_COMPLETE_SNAPSHOT`, block `13,507,736` |
| Snapshot hash | `0x6882ed209f767598bf68c7848e7fc333748fee1fe17ff549591816818fbaa14b` |
| Snapshot block hash | `0x5e1e8684b0ab12c6938ae4fbe6d8b5a434b4321f0f6b71f7f07e18cc3a286d6` |
| Freshness | source age `35s` at health observation, index lag `22s` |
| Preflight | `AVAILABLE / ALLOW / LOW` for exact `0.01 STRK` |
| Decision ID | `0x4f883d819251014c9c395380a537b08f456026008d5c616284c160c10ec9c0c6` |
| Wallet boundary | simulation-only smoke: `connectCalls=1`, `prepareCalls=1`, `invokeCalls=0` |
| Transaction state | no hash, confirmation, broadcast, or submission |

During the v0.1.3 restart, the public health endpoint briefly returned
`503 / STALE_SNAPSHOT / SNAPSHOT_UNAVAILABLE` while the single indexer writer
re-established a stable range. It recovered to the complete snapshot recorded
above. This is the intended fail-closed transition, not an `ALLOW` decision
from uncertain state.

## Ongoing host operations

The deployment owner must continue to retain persistent-volume backups, verify
restart and rollback procedures, monitor fail-closed health transitions, and
restrict administrative SSH ingress to the operator's current IP range.
Those are infrastructure operations, separate from the browser wallet's
execution authority.

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

The backup command reads and reports the database's stored schema, ABI, and
model identity without forcing a v1.3 or v1.4 application runtime over the
source. It refuses to overwrite an existing file or copy a database belonging
to another chain/pool. Verify a backup by opening it read-only, running SQLite
`quick_check` against that copy, and checking `/api/health` with the matching
restored runtime. The live request-time health path does not run a deep
database scan.

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

Schema v1 databases migrate forward to the current schema in place. Release
v0.2.0 uses schema version `4` and persists the model identity so a v1.3
database is replayed before v1.4 evidence is served; a read-only model mismatch
fails closed. A code rollback is not assumed to understand a newer schema,
which is why the pre-deployment backup is part of the rollback contract. A
rollback to v0.1.4 therefore restores the matching pre-deployment v1.3 database
backup before starting the prior runtime.

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
