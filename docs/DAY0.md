# Day 0 mainnet check

This check removes the largest external risk before product development: whether
the currently shipped wallet, proving, discovery, relaying, and note-maturity
path works on Starknet mainnet.

## What the wallet owner provides

- the public Starknet account address used for the sprint
- three or preferably four successful transaction hashes
- the public recipient address used for the private transfer, when different

Never share a seed phrase, private key, viewing key, recovery phrase, wallet
backup, or secret RPC credential. Cutout does not need them.

## Preparation

1. Open the official [STRK20 live-apps page](https://strk20.starknet.io/app/live-apps)
   and follow its verified Ready link. Do not install from a search advertisement
   or an unsolicited direct message.
2. Create or select a Starknet mainnet account dedicated to the sprint.
3. Fund it with only the small amount of STRK needed for gas and the test value.
4. Prepare a second registered recipient when Ready cannot privately transfer to
   the same account. Fund that account for registration gas if required.
5. Confirm the wallet displays Starknet **mainnet**, not Sepolia.

## Flow

1. Register the sender's viewing key.
2. Register the recipient's viewing key when a separate recipient is required.
3. Shield a small amount through the STRK20 pool.
4. Wait until the shield transaction is accepted and the resulting note has
   matured. STRK20 notes become spendable 10 blocks after creation; follow the
   wallet's status rather than estimating wall-clock time.
5. Make one small private transfer.
6. Save every transaction hash and the public sender/recipient account addresses.

Bank four hashes when the recipient needs its own registration transaction. The
submission requires at least three, but extra verified transactions are useful
insurance.

## Verification

Run:

```bash
npm run verify:transactions -- 0xHASH_1 0xHASH_2 0xHASH_3
```

A qualifying hash must:

- exist on Starknet mainnet
- have `execution_status: SUCCEEDED`
- contain at least one event emitted by the STRK20 pool

Only hashes passing this verifier should be added to `strk20.json`. A relayed
private transaction may not have the user's account as its transaction sender;
the pool event is the relevant integration evidence.

## Report back

Provide only:

```text
Sprint account: 0x...
Recipient account: 0x...  # when separate
Transactions:
0x...
0x...
0x...
```

The repository maintainer will verify the receipts and update `strk20.json`.
