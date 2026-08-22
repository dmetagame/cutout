# @cutout/guard

`@cutout/guard` is the stable integration boundary for Cutout's public
preflight evidence and guarded STRK20 deposit workflow. It provides:

- typed preflight request and response contracts;
- fail-closed final action and evidence validation;
- amount conversion helpers;
- simulation and explicit-approval binding;
- deterministic public receipt verification;
- frozen model, policy, network, pool, and token metadata.

The v0.2.0 package can request typed CUTOUT-v1.4 deposit or withdrawal
evidence. Withdrawal analysis is evidence-only and exports no wallet execution
path; the guarded deposit remains the only executable workflow.

It does not include the indexer, SQLite store, RPC runtime, wallet discovery,
wallet submission, private notes, viewing keys, shielded balances, or proofs.
The wallet remains the only signing authority.

For React applications, the optional `@cutout/guard/react` subpath provides
`useCutoutEvidence` and `CutoutEvidencePanel`. They call/render preflight only;
the subpath has no wallet discovery, simulation, authorization, invoke, or
submission export.

```ts
import {
  CUTOUT_MAINNET,
  CUTOUT_VERSIONS,
  parseTokenAmount,
  validateSingleDepositAction,
  type WireShieldIntent,
} from "@cutout/guard";

const amount = parseTokenAmount("0.01", 18);
const token = CUTOUT_MAINNET.tokens.find((item) => item.symbol === "STRK");
if (!token) throw new Error("STRK is not configured");

const intent: WireShieldIntent = {
  action: "shield",
  chainId: CUTOUT_MAINNET.chainId,
  account: "0x1",
  token: token.address,
  amount: amount.toString(10),
  evaluationBlock: 0,
  evaluationTimestamp: 0,
  flexibility: { mode: "exact" },
  deadline: 600,
};

const action = validateSingleDepositAction([{
  type: "deposit",
  token: intent.token,
  amount: `0x${amount.toString(16)}`,
}]);

console.log(CUTOUT_VERSIONS.model, action);
```

In the signing workflow, use `requestPreflight`, re-run preflight for the exact
selected amount, call `createGuardedDepositPlan`, validate wallet simulation,
and require explicit user approval before any wallet-owned submission method.
