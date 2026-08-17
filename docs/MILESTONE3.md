# Milestone 3: Signing-Decision Client

**Status:** COMPLETE. Controlled Ready X mainnet submission and independent
public receipt verification completed on 2026-08-17.

## Implemented

- Pure decimal/base-unit amount parsing and formatting.
- Pure canonical hashing for browser decision IDs and receipt IDs.
- Pure exact-action guard validation.
- Final exact-intent binding and re-preflight enforcement.
- Wallet API simulation and isolated submission adapter.
- Deterministic public receipt verification and versioned artifact creation.
- Next.js App Router signing-decision UI.
- Wallet connection state, mainnet validation, amount flexibility, evidence,
  recommendation selection, final review, simulation, and confirmation state.
- Session-scoped versioned receipt page.
- Wallet Standard Playwright harness and fail-closed browser tests.

## Frozen boundaries

Milestone 1 and Milestone 2 behavior remains the source of truth for:

- `CUTOUT-v1.3` scoring;
- `FRESHNESS_POLICY-v1`;
- `GUARD_POLICY-v1`;
- WalletAccountV6 capability detection and simulation;
- SQLite canonical snapshots and the single preflight API.

The browser never calculates an independent risk result. It consumes the API's
canonical snapshot hash, evidence, model version, and guard policy version.

## Fixture verification

Fixture-backed browser verification uses:

| Item | Value |
|---|---|
| Framework | Next.js `16.3.1`, React `19.2.8` |
| Wallet adapter | `starknet.js 10.4.0`, `WalletAccountV6` |
| Required Wallet API | `0.10.3` |
| Chain | Starknet mainnet chain ID `0x534e5f4d41494e` |
| Runtime | deterministic SQLite fixture mode |
| Snapshot | `0xb32956e51d2e66c0d08c08d3112824c1b837658fde66cee40851c88095861e50` |
| Observed block | `9,000,100` |
| Initial result | `MEDIUM / WARN`, recommendation `4,700 USDC` |
| Final result | `LOW / ALLOW` for the selected recommendation |

The E2E harness registers through Wallet Standard, proves capability
negotiation, constructs one typed `deposit`, calls
`strk20PrepareInvoke(actions, true)`, and stops at `READY_FOR_CONFIRMATION`.
It asserts that the broadcast method was not invoked.

Commands passed after the live correction:

```text
npm run web:typecheck
npm run typecheck
npm run check
npm run web:build
npm run test:e2e
```

The browser suite covers the successful checkpoint, wrong network, unsupported
Wallet API, simulation failure, malformed amount, and narrow viewport paths.

## Controlled mainnet verification

One explicitly authorized mainnet deposit was submitted through Ready X after a
fresh final preflight and successful `strk20PrepareInvoke(actions, true)`.

| Item | Value |
|---|---|
| Wallet | Ready X `5.33.8` |
| Wallet API | `0.10.3` |
| Account | `0x05854e275d709627eb88a95519326c528f8c5dc402d350d29e72dbcaf48b434f` |
| Action | one STRK20 `deposit` |
| Token | STRK `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| Amount | `0.01 STRK` / `10000000000000000` base units |
| Pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Final decision | `LOW / ALLOW` |
| Snapshot block | `13,427,498` |
| Snapshot hash | `0xbe131fcf5f63309e40b8e3656465e56bac7f5b8a1b8d5336974071bfabc34acf` |
| Transaction | `0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e` |
| Included block | `13,427,531` |
| Included block hash | `0x7c07bd1afcbf10a69bcb9ff23643a98469c9f7a76183962bdc5c8389da67e94` |
| Receipt status | `SUCCEEDED / ACCEPTED_ON_L2` |
| Receipt artifact | `CUTOUT_RECEIPT-v1` / `0x09adfe7664898666360052a35a9e3551e1c343c14fff37ea6d6fafb9046d643c` |

The receipt contains exactly one reviewed pool `Deposit` event whose account,
token, and amount match the guarded action.

### Receipt-provider correction

The controlled run exposed one concrete client defect after submission:
`WalletAccountV6` did not expose the public receipt-wait method expected by the
UI. Cutout failed closed with `RECEIPT_UNAVAILABLE` and did not claim success.

Receipt lookup now uses an independent configured Starknet `RpcProvider`, while
Ready X remains responsible only for simulation, signing, and submission. The
existing deterministic receipt verifier then checks the public result. This
separation is covered by the Milestone 3 unit suite.

The corrected browser `RpcProvider.waitForTransaction` path was also replayed
against the same transaction and returned its accepted 18-event receipt without
making any wallet request.

Final verification results:

- `npm run check`: 112 passed;
- `npm run web:typecheck`: passed;
- `npm run web:build`: passed;
- `npm run test:e2e`: 6 passed.

## Security assertions

The client and backend do not handle private keys, seed phrases, viewing keys,
notes, proof secrets, shielded balances, or arbitrary calldata. The backend
cannot sign or submit. The wallet remains the only signing authority.

Cutout reports public-observer candidate-cohort evidence. It does not claim
anonymity, untraceability, unlinkability, or a probability of deanonymization.
