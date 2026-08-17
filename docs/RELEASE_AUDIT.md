# Final release and security audit

**Review date:** 2026-08-17

This review treats CUTOUT-v1.3, FRESHNESS_POLICY-v1, GUARD_POLICY-v1, the
canonical indexer, WalletAccountV6 flow, and receipt binding as frozen
foundations. No scoring or signing behavior was changed.

## Findings

| Area | Result | Evidence |
|---|---|---|
| Signing authority | PASS | Submission remains isolated in the browser wallet adapter; server/indexer routes cannot import it. |
| Backend signing/broadcast | PASS | No server route owns a wallet account or invokes a submission method. |
| Private material | PASS | No private-key, seed, viewing-key value, note, proof, or shielded-balance path is present. |
| Action boundary | PASS | One exact `deposit` only; mixed, transfer, withdraw, invoke, and arbitrary calldata fail closed. |
| Snapshot integrity | PASS | Stale, partial, corrupt, hash-inconsistent, reorging, and schema-uncertain snapshots cannot produce `LOW / ALLOW`. |
| RPC failover | PASS | Both providers are chain-checked and common-block cross-checked; disagreement fails closed. |
| Pool schema | PASS | Reviewed class hash and ABI selectors are required; unexpected changes return `POOL_SCHEMA_MISMATCH`. |
| Amount bounds | PASS | Positive u128 base units, target/min/max order, displayed amount, selected recommendation, and final exact intent are bound. |
| Recommendation | PASS | Existing deterministic engine only; no out-of-range or fabricated candidate path. |
| Receipt binding | PASS | Public receipt must match transaction, account, pool, token, amount, selector, block, and success/finality state. |
| Telemetry | PASS | Server logs and metrics omit raw account, amount, and intent bodies. |
| Package surface | PASS | One root export; no indexer, DB, RPC runtime, wallet submission, or engine execution export. |
| Container permissions | PASS | Non-root user, capability drop, `no-new-privileges`, SQLite read-only/query-only API connection, pruned dev dependencies. The shared volume is writable only because WAL readers require SHM coordination. |
| Backup/recovery | PASS | Online SQLite backup and deterministic restore/restart paths are tested. |

## Dependency and secret review

- Runtime versions are pinned for Starknet, Next.js, React, and wallet discovery.
- `npm audit --omit=dev --audit-level=high` is a release gate.
- `.env` and data/backup files are ignored; `.env.example` contains no secret.
- Server RPC credentials must never use a `NEXT_PUBLIC_` prefix.
- `CUTOUT_BROWSER_RPC_URL` is intentionally public and must not contain a
  credential.
- The package's only runtime dependency is the already-pinned
  `starknet@10.4.0`, used for canonical Starknet address validation.

## Release blockers outside code

1. No external deployment target host or HTTPS endpoint has been configured or
   verified. Local production-like Docker evidence is not a public deployment.
2. Publishing `@cutout/guard` to a registry requires repository-owner package
   credentials and an explicit publish decision. The tarball itself is tested.
3. The final release-day browser CDP endpoint was unavailable. This did not
   invalidate the previously completed real Ready X simulation, but no new
   browser-wallet claim is made for the final smoke.

These blockers must be reported rather than replaced with fabricated browser,
deployment, or registry evidence.

The detailed final adversarial matrix is in
[FINAL_SECURITY_REVIEW.md](FINAL_SECURITY_REVIEW.md). It records implemented
controls separately from residual risks such as colluding RPC providers,
compromised browser or wallet software, and telemetry outside the published
passive-public-observer threat model.
