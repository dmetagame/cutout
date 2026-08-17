# CUTOUT v0.1.0

Cutout is a deterministic STRK20 signing guard that evaluates public
exact-amount cohort evidence before a user signs.

## Included

- Frozen deterministic `CUTOUT-v1.3` engine.
- Fail-closed `FRESHNESS_POLICY-v1` and `GUARD_POLICY-v1`.
- Incremental public STRK20 indexer with canonical block tracking, deterministic
  snapshots, reorg recovery, pool class-hash validation, and RPC cross-checking.
- Single `POST /api/preflight` evidence boundary.
- Wallet Standard / Wallet API 0.10.3 integration through WalletAccountV6.
- One supported typed action: STRK20 `deposit`.
- Mandatory final preflight, simulation, explicit wallet confirmation, and
  wallet-owned submission flow.
- Independent public receipt verification bound to account, pool, token, and
  amount.
- Production-like SQLite/Docker hardening, health checks, backups, and CI.
- `@cutout/guard@0.1.0` integrator package with a deliberately narrow root API.

## Mainnet evidence

Historical controlled transaction:
`0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e`

The final release smoke was non-submitting and used fresh mainnet snapshot
`0xf39aafdf488e51701a0531f6ef39a899f96d8b166b2439ee632ba60dec32cecb`
at block `13,442,541`. No broadcast method was invoked and no transaction hash
was produced.

## Verification

- 135 root tests
- 18 Milestone 4 focused tests
- 5 Milestone 5 focused tests
- 3 package API tests
- 6 browser E2E tests
- Root/web typechecks and production build
- Packed consumer verification
- Docker/Compose validation
- Dependency audit with 0 vulnerabilities

## Security boundary and non-claims

The backend cannot sign or broadcast, and Cutout never receives private keys,
seed phrases, viewing-key payloads, private notes, proofs, or shielded balances.
Users retain final wallet authority.

Cutout is a signing guard, not a privacy guarantee. It does not claim anonymity,
untraceability, guaranteed unlinkability, or a probability of deanonymization.

External deployment and npm registry publication are separate release actions
and are not implied by this GitHub release.
