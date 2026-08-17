# Guard Boundary

The guard is the pure boundary between public evidence and wallet execution.
It does not score privacy independently and it does not make a wallet call.

## Accepted action

The only accepted action is exactly one object with exactly these keys:

```json
{
  "type": "deposit",
  "token": "0x...",
  "amount": "0x..."
}
```

The guard rejects empty arrays, mixed arrays, transfers, withdrawals, arbitrary
invokes, extra calldata, malformed addresses, non-integer amounts, zero, and
values outside the positive u128 range. The token must be configured for the
reviewed pool.

## Validation order

Before simulation or submission, the guard validates:

- the shield action and chain;
- the configured pool and supported token;
- canonical base-unit amount encoding;
- `min <= target <= max` for flexible intent;
- recommendation token, action, and amount identity;
- recommendation bounds and healthy cohort evidence;
- exact final intent against the selected amount;
- snapshot hash, observed block, and freshness;
- `CUTOUT-v1.3` and `GUARD_POLICY-v1` versions;
- wallet account identity and Starknet mainnet chain;
- Wallet API `0.10.3` or newer;
- final preflight decision.

The invariant is:

```text
NO VALIDATION -> NO WALLET CALL
```

`HIGH` becomes `DENY`, `MEDIUM` becomes `WARN`, and `LOW` becomes `ALLOW`
only through the frozen `GUARD_POLICY-v1`. Operational uncertainty has no
decision and no risk band.

## Simulation and authorization

Simulation is evidence, not authorization. The wallet adapter must call:

```ts
account.strk20PrepareInvoke([validatedAction], true)
```

The guard accepts the result only when it identifies the reviewed pool,
`apply_actions`, non-empty calldata, an explicit simulation flag, and an empty
proof. The action binding includes chain, pool, account, action, token, amount,
snapshot hash, and decision ID.

Submission authorization requires:

- a still-fresh validated plan;
- matching simulation evidence;
- explicit user approval;
- warning acknowledgement when the final decision is `WARN`.

Only then may the browser call `strk20InvokeTransaction` with the same single
deposit action. The backend never participates in this call.

## Frozen dependencies

The guard consumes the existing `CUTOUT-v1.3` engine and the existing
`FRESHNESS_POLICY-v1` and `GUARD_POLICY-v1`. It does not add a new score,
anonymity calculation, or LLM explanation.
