# Versioned Public Receipt

Cutout displays success only after independently checking the public receipt
for the exact action that passed the signing guard.

The browser obtains the submitted transaction hash from Ready X, then waits for
the receipt through a separately configured public Starknet `RpcProvider`.
Receipt availability is not inferred from the wallet account object. This keeps
public verification independent from the signing authority.

## Verification requirements

The receipt verifier requires:

- `execution_status: SUCCEEDED`;
- `finality_status: ACCEPTED_ON_L2` or `ACCEPTED_ON_L1`;
- the submitted transaction hash;
- a valid block number and block hash;
- exactly one `Deposit` event from the configured pool;
- the ABI-derived `Deposit` selector;
- the reviewed depositor account;
- the reviewed token;
- the reviewed base-unit amount.

Any missing or mismatched value raises `RECEIPT_MISMATCH`. The UI must not
claim completion in that case.

## Artifact schema

The current schema is `CUTOUT_RECEIPT-v1`:

```json
{
  "schemaVersion": "CUTOUT_RECEIPT-v1",
  "transactionHash": "0x...",
  "chainId": "0x534e5f4d41494e",
  "pool": "0x...",
  "token": "0x...",
  "amount": "4700000000",
  "account": "0x...",
  "blockNumber": 0,
  "blockHash": "0x...",
  "observedSnapshotHash": "0x...",
  "engineVersion": "CUTOUT-v1.3",
  "guardPolicyVersion": "GUARD_POLICY-v1",
  "decision": "ALLOW",
  "selectedAmount": "4700000000",
  "recommendationStatus": "ACCEPTED",
  "timestamp": 0,
  "receiptId": "0x..."
}
```

`receiptId` is SHA-256 over the canonical artifact fields before `receiptId` is
added. The same verified public receipt and evidence produce the same ID.

## Storage and privacy

Milestone 3 stores the artifact in browser `sessionStorage` under its receipt
ID so the versioned receipt page can be revisited in the current browser
session. It does not create a tracking account or send receipt artifacts to
the backend. The artifact contains public transaction/evidence provenance only;
it contains no keys, notes, viewing keys, proofs, balances, or private wallet
telemetry.

## Explorer links

The receipt page may link to a public Starkscan transaction URL. The link is
informational; the local verifier remains the authority for whether Cutout
claims the expected deposit was included.

## Controlled mainnet receipt

The Milestone 3 controlled deposit produced transaction
`0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e`.
The public RPC receipt reports `SUCCEEDED / ACCEPTED_ON_L2` at block
`13,427,531`. The verifier matched exactly one STRK20 `Deposit` for the reviewed
account, STRK token, pool, and `10000000000000000` base-unit amount. Its replayed
`CUTOUT_RECEIPT-v1` identifier is
`0x09adfe7664898666360052a35a9e3551e1c343c14fff37ea6d6fafb9046d643c`.
