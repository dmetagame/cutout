# Signing Decision Workflow

Milestone 3 adds the first user-facing Cutout flow. It is a signing guard, not
a wallet and not a replacement for the wallet's confirmation screen.

## Boundaries

```text
User
  |
  v
Cutout browser UI
  |
  +--> typed shield intent --> POST /api/preflight --> canonical snapshot
  |                                              |
  |                                              v
  |                                      CUTOUT-v1.3
  |                                              |
  |                                              v
  |                                      GUARD_POLICY-v1
  |
  +--> final exact preflight --> pure guard validation
                                      |
                                      v
                              WalletAccountV6
                                      |
                                      v
                         strk20PrepareInvoke(actions, true)
                                      |
                                      v
                             explicit user approval
                                      |
                                      v
                         strk20InvokeTransaction(actions)
                                      |
                                      v
                     independent public RPC receipt
                                      |
                                      v
                           deterministic verification
```

The API supplies public evidence and deterministic recommendations only. It
cannot sign, broadcast, change the token, change the amount, or execute a
transaction.

## User flow

1. The browser discovers a Wallet Standard Starknet wallet.
2. Cutout requires Wallet API `0.10.3` or newer, constructs `WalletAccountV6`,
   and verifies `SN_MAIN`.
3. The user enters a token, target amount, and either exact or flexible bounds.
4. The browser sends the typed shield intent to `POST /api/preflight`.
5. The response renders the model band, operational decision, signals, cohort
   quality, freshness, snapshot hash, and non-claims.
6. If a permitted healthy alternative exists, the user may choose it or keep
   the original amount. The range is never widened silently.
7. Cutout creates a new exact final intent and calls preflight again. The first
   result is never reused as signing authority.
8. The pure guard binds the final amount, token, account, pool, snapshot,
   model, policy, and decision into one validated deposit plan.
9. The browser calls `strk20PrepareInvoke([action], true)` for simulation.
10. The UI shows the exact action returned by the guard. The user then chooses
    the wallet confirmation action explicitly.
11. Only after that approval may the isolated wallet adapter call
    `strk20InvokeTransaction([action])`.
12. The browser gives the submitted transaction hash to a configured public
    Starknet `RpcProvider`; it does not rely on the wallet account as a receipt
    provider.
13. The browser verifies the expected pool `Deposit` event before displaying
    success.

## Fail-closed states

No wallet call is made unless all guard checks pass. Wallet absence, unsupported
Wallet API, wrong network, malformed input, stale preflight, snapshot mismatch,
model/policy mismatch, failed simulation, and user rejection remain explicit
failure states. None is converted to `LOW` or `ALLOW`.

No receipt is treated as success. A missing, reverted, unfinalized, or mismatched
receipt is rendered as verification failure or transaction status uncertainty.

## Privacy boundary

The browser and API use only the typed public transaction intent and public
STRK20 evidence. Cutout never receives private keys, seed phrases, viewing
keys, notes, proofs, shielded balances, or private wallet history.

The browser owns the signing state. The backend has no signing or submission
capability.

## Verification

The deterministic Playwright Wallet Standard harness reaches
`READY_FOR_CONFIRMATION`, after successful final preflight and simulation, and
asserts that no broadcast request was made.

A separate controlled Ready X run submitted one `0.01 STRK` mainnet deposit.
The transaction was accepted on L2 and the independent receipt verifier matched
the exact pool, account, token, and amount. See `docs/MILESTONE3.md` for the
transaction and snapshot provenance.
