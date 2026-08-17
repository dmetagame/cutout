# Security boundary

Cutout is a signing guard around a single public STRK20 deposit action. It is
not a wallet, custodian, mixer, privacy guarantee, or autonomous executor.

## Trust and authority

```text
User intent
    -> browser guard and UI
    -> read-only preflight API
    -> deterministic CUTOUT-v1.3 engine
    -> public canonical snapshot

User choice
    -> WalletAccountV6 / Ready X
    -> wallet confirmation
    -> wallet-owned submission
```

| Component | May influence | Must never do |
|---|---|---|
| Browser UI | Display intent, evidence, recommendations, and review state. | Invent evidence, broaden flexibility, or sign without explicit wallet authority. |
| Pure guard | Validate chain, pool, token, amount, action, snapshot, model, and policy. | Accept arbitrary calldata or call a wallet before validation. |
| API | Return public evidence and deterministic recommendations. | Sign, broadcast, alter the final amount/token/action, or receive private STRK20 state. |
| Indexer | Normalize public `Deposit`/`ViewingKeySet` events and provenance. | Read viewing keys, notes, shielded balances, or proofs. |
| Wallet | Hold keys, request confirmation, sign, and submit. | Delegate signing authority to the backend. |
| Receipt verifier | Independently read public inclusion and expected event data. | Treat a hash alone as proof of a matching deposit. |

The server source and route regression test assert that server-side modules do
not import `WalletAccountV6`, contain `strk20InvokeTransaction`, or expose
private-key/seed/viewing-key handling.

The published `@cutout/guard` root export is narrower still: it exposes only
action validation, preflight contracts/client, final guard validation, amount
helpers, version metadata, and public receipt verification. Package tests reject
wallet, indexer, SQLite, RPC-ingestion, operations-runtime, and engine-execution
exports. Node package `exports` blocks supported deep imports.

## Action boundary

The only accepted shape is one typed action:

```json
{
  "type": "deposit",
  "token": "0x...",
  "amount": "0x..."
}
```

Transfer, withdrawal, arbitrary invoke, mixed arrays, arbitrary calldata, and
unknown tokens fail closed with `UNSUPPORTED_ACTION` or
`UNSUPPORTED_TOKEN`. Base-unit amounts are validated as integers and are bound
to the exact final review state.

## Data handling

The backend and indexer receive only:

- public Starknet block/event data;
- the typed public shield intent required for a preflight request;
- public receipt data after a user-controlled submission.

The system never receives or persists:

- private keys or seed/recovery phrases;
- viewing keys or encrypted viewing-key payloads;
- private notes;
- proof secrets or shielded balances;
- wallet history beyond public STRK20 observations;
- user IP/identity telemetry for the purpose of a privacy decision.

Application logs omit raw account addresses and requested amounts. Health and
metrics are aggregate operational data. RPC URLs containing credentials remain
server-only; no server RPC environment variable is prefixed `NEXT_PUBLIC_`.
The deterministic `CUTOUT_FIXED_NOW` test clock is ignored when
`NODE_ENV=production`, so deployment freshness cannot be pinned by configuration.

## RPC and data integrity

The indexer validates expected chain ID, reviewed pool address/class hash,
block hashes, parent links, timestamps, event selectors, continuation-token
exhaustion, and snapshot hashes. Primary/secondary disagreement is an explicit
failure. A stale, partial, corrupt, or schema-uncertain read model cannot
produce `LOW`/`ALLOW`.

An RPC provider is trusted only for the public response it supplies at a given
moment; failover and cross-checking reduce single-provider failure modes but do
not make the infrastructure decentralized or malicious-provider-proof.

## Storage and process security

- Run one indexer writer per SQLite file.
- Restrict the database directory to the service account.
- Open the API database with SQLite `readOnly` and `PRAGMA query_only`. The
  shared volume must remain filesystem-writable for WAL/SHM coordination; the
  indexer remains the only application component with a write path.
- Keep `.env`, backups, WAL, and SHM files out of source control.
- Use HTTPS between browsers and the deployment edge.
- Keep Node and dependencies patched; run `npm audit --omit=dev --audit-level=high`.
- Run the provided container as its unprivileged `node` user.
- Drop Linux capabilities and set `no-new-privileges` in Compose.
- Prune development dependencies from the runtime image.
- Treat database backups as public-observation data, but protect their
  integrity and availability.
- Do not expose the indexer port or SQLite filesystem to the public network.

The container does not contain wallet credentials. The browser-visible RPC URL
must be a public URL without embedded credentials.

## Failure behavior

The safe outcomes are explicit: evidence unavailable, unsupported action,
wrong network, stale snapshot, schema mismatch, simulation failure, user
rejection, or receipt mismatch. None is converted into a favorable decision.

Receipt verification uses an independent public RPC path. A transaction is not
shown as successfully completed unless inclusion and the expected pool event
match the typed action. This does not protect against a compromised wallet,
browser, dApp, RPC telemetry, exchange records, front-running, or other threats
outside the published passive-public-observer model.

## Operational review checklist

Before opening a live demo, verify:

- no secret-bearing environment variable is browser-exposed;
- exactly one indexer writer is running;
- health is current and schema-compatible;
- backups exist and are readable;
- server routes cannot call wallet submission;
- the displayed final action matches the wallet prompt;
- the presenter understands that simulation is not submission permission.

See [THREAT_MODEL.md](THREAT_MODEL.md) for the full threat model and its
non-claims, and [RELEASE_AUDIT.md](RELEASE_AUDIT.md) for the Milestone 5
release review.
