import {
  CUTOUT_MAINNET,
  CUTOUT_VERSIONS,
  parseTokenAmount,
  validateSingleDepositAction,
  type WireShieldIntent,
} from "@cutout/guard";

const token = CUTOUT_MAINNET.tokens.find((candidate) => candidate.symbol === "STRK");
if (token === undefined) throw new Error("STRK configuration is unavailable");

const amount = parseTokenAmount("0.01", token.decimals);
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

console.log(JSON.stringify({
  packageApi: CUTOUT_VERSIONS.packageApi,
  model: CUTOUT_VERSIONS.model,
  chainId: intent.chainId,
  action,
}));
