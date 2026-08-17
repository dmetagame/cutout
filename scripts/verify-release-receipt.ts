import { loadPoolAbiFixture, reviewPoolAbi } from "../src/starknet/abi.js";
import { verifyDepositReceipt } from "../src/workflow/receipt.js";
import type { PublicTransactionReceipt } from "../src/workflow/types.js";

const EVIDENCE = {
  transactionHash: "0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e",
  receiptId: "0x09adfe7664898666360052a35a9e3551e1c343c14fff37ea6d6fafb9046d643c",
  chainId: "0x534e5f4d41494e",
  poolAddress: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  token: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  amount: "10000000000000000",
  account: "0x05854e275d709627eb88a95519326c528f8c5dc402d350d29e72dbcaf48b434f",
  observedSnapshotHash: "0xbe131fcf5f63309e40b8e3656465e56bac7f5b8a1b8d5336974071bfabc34acf",
  engineVersion: "CUTOUT-v1.3",
  guardPolicyVersion: "GUARD_POLICY-v1",
  decision: "ALLOW",
  recommendationStatus: "ORIGINAL",
  timestamp: 1_786_955_795,
} as const;

async function rpcReceipt(rpcUrl: string): Promise<PublicTransactionReceipt> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_getTransactionReceipt",
      params: [EVIDENCE.transactionHash],
    }),
  });
  if (!response.ok) throw new Error(`Receipt RPC returned HTTP ${response.status}.`);
  const payload = await response.json() as {
    readonly result?: unknown;
    readonly error?: { readonly message?: unknown };
  };
  if (payload.error !== undefined) {
    throw new Error(typeof payload.error.message === "string"
      ? payload.error.message
      : "Receipt RPC returned an error.");
  }
  if (payload.result === undefined) throw new Error("Receipt RPC returned no result.");
  return payload.result as PublicTransactionReceipt;
}

const rpcUrl = process.env.RPC_URL ?? "https://rpc.starknet.lava.build";
const abi = reviewPoolAbi(await loadPoolAbiFixture());
const receipt = await rpcReceipt(rpcUrl);
const artifact = await verifyDepositReceipt(receipt, {
  transactionHash: EVIDENCE.transactionHash,
  chainId: EVIDENCE.chainId,
  poolAddress: EVIDENCE.poolAddress,
  depositSelector: abi.deposit.selector,
  token: EVIDENCE.token,
  amount: EVIDENCE.amount,
  account: EVIDENCE.account,
  observedSnapshotHash: EVIDENCE.observedSnapshotHash,
  engineVersion: EVIDENCE.engineVersion,
  guardPolicyVersion: EVIDENCE.guardPolicyVersion,
  decision: EVIDENCE.decision,
  recommendationStatus: EVIDENCE.recommendationStatus,
  timestamp: EVIDENCE.timestamp,
});
if (artifact.receiptId !== EVIDENCE.receiptId) {
  throw new Error(`Receipt artifact mismatch: ${artifact.receiptId}.`);
}

console.log(JSON.stringify({
  status: "VERIFIED",
  source: "PUBLIC_RPC",
  historicalMilestone: 3,
  artifact,
  walletMethodInvoked: false,
  transactionSubmitted: false,
}, null, 2));
