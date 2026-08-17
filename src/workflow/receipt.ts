import type {
  CutoutReceiptArtifact,
  PublicReceiptEvent,
  PublicTransactionReceipt,
  ReceiptExpectation,
} from "./types.js";
import { RECEIPT_SCHEMA_VERSION, WorkflowError } from "./types.js";
import { parseBaseUnitAmount } from "./amounts.js";
import { workflowSha256 } from "./canonical.js";

const FELT = /^0x[0-9a-fA-F]+$/;

function normalizeFelt(value: unknown, field: string): string {
  if (typeof value !== "string" || !FELT.test(value)) {
    throw new WorkflowError("RECEIPT_MISMATCH", `${field} is missing or malformed.`);
  }
  return `0x${BigInt(value).toString(16)}`;
}

function normalizeAddress(value: unknown, field: string): string {
  const normalized = normalizeFelt(value, field);
  if (BigInt(normalized) >= (1n << 251n)) {
    throw new WorkflowError("RECEIPT_MISMATCH", `${field} is outside the Starknet address range.`);
  }
  return `0x${normalized.slice(2).padStart(64, "0")}`;
}

function receiptEvent(value: unknown): PublicReceiptEvent {
  if (value === null || typeof value !== "object") {
    throw new WorkflowError("RECEIPT_MISMATCH", "Receipt contains a malformed event.");
  }
  const event = value as Record<string, unknown>;
  return {
    from_address: event.from_address,
    keys: event.keys,
    data: event.data,
  };
}

function artifactCore(input: {
  readonly receipt: PublicTransactionReceipt;
  readonly expectation: ReceiptExpectation;
  readonly transactionHash: `0x${string}`;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly account: string;
  readonly token: string;
  readonly amount: string;
  readonly pool: string;
}): Omit<CutoutReceiptArtifact, "receiptId"> {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    transactionHash: input.transactionHash,
    chainId: normalizeFelt(input.expectation.chainId, "expected chain"),
    pool: input.pool,
    token: input.token,
    amount: input.amount,
    account: input.account,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    observedSnapshotHash: input.expectation.observedSnapshotHash,
    engineVersion: input.expectation.engineVersion,
    guardPolicyVersion: input.expectation.guardPolicyVersion,
    decision: input.expectation.decision,
    selectedAmount: input.amount,
    recommendationStatus: input.expectation.recommendationStatus,
    timestamp: input.expectation.timestamp,
  };
}

export async function verifyDepositReceipt(
  receiptInput: PublicTransactionReceipt,
  expectation: ReceiptExpectation,
): Promise<CutoutReceiptArtifact> {
  if (receiptInput === null || typeof receiptInput !== "object") {
    throw new WorkflowError("RECEIPT_MISMATCH", "Transaction receipt is unavailable.");
  }
  if (receiptInput.execution_status !== "SUCCEEDED") {
    throw new WorkflowError("RECEIPT_MISMATCH", "Transaction did not complete successfully.");
  }
  if (
    receiptInput.finality_status !== "ACCEPTED_ON_L2" &&
    receiptInput.finality_status !== "ACCEPTED_ON_L1"
  ) {
    throw new WorkflowError("RECEIPT_MISMATCH", "Transaction is not included in an accepted block.");
  }
  const transactionHash = normalizeFelt(receiptInput.transaction_hash, "receipt transaction hash");
  if (transactionHash !== normalizeFelt(expectation.transactionHash, "expected transaction hash")) {
    throw new WorkflowError("RECEIPT_MISMATCH", "Receipt transaction hash does not match the submitted transaction.");
  }
  if (
    typeof receiptInput.block_number !== "number" ||
    !Number.isSafeInteger(receiptInput.block_number) ||
    receiptInput.block_number < 0
  ) {
    throw new WorkflowError("RECEIPT_MISMATCH", "Receipt block number is missing or invalid.");
  }
  const blockHash = normalizeFelt(receiptInput.block_hash, "receipt block hash");
  if (!Array.isArray(receiptInput.events)) {
    throw new WorkflowError("RECEIPT_MISMATCH", "Receipt events are missing.");
  }
  const pool = normalizeAddress(expectation.poolAddress, "expected pool");
  const selector = normalizeFelt(expectation.depositSelector, "Deposit selector");
  const expectedAccount = normalizeAddress(expectation.account, "expected depositor");
  const expectedToken = normalizeAddress(expectation.token, "expected token");
  const expectedAmount = parseBaseUnitAmount(expectation.amount, "expected amount");

  const poolDepositEvents: Array<{ account: string; token: string; amount: bigint }> = [];
  for (const value of receiptInput.events) {
    const event = receiptEvent(value);
    if (normalizeAddress(event.from_address, "event source") !== pool) continue;
    if (!Array.isArray(event.keys) || event.keys.length === 0) continue;
    if (normalizeFelt(event.keys[0], "event selector") !== selector) continue;
    if (event.keys.length !== 3 || !Array.isArray(event.data) || event.data.length !== 1) {
      throw new WorkflowError("RECEIPT_MISMATCH", "Deposit event does not match the reviewed ABI shape.");
    }
    poolDepositEvents.push({
      account: normalizeAddress(event.keys[1], "Deposit depositor"),
      token: normalizeAddress(event.keys[2], "Deposit token"),
      amount: BigInt(normalizeFelt(event.data[0], "Deposit amount")),
    });
  }
  if (poolDepositEvents.length !== 1) {
    throw new WorkflowError("RECEIPT_MISMATCH", "Receipt must contain exactly one STRK20 Deposit event.");
  }
  const deposit = poolDepositEvents[0];
  if (deposit === undefined) {
    throw new WorkflowError("RECEIPT_MISMATCH", "Expected STRK20 Deposit event is missing.");
  }
  if (deposit.account !== expectedAccount) {
    throw new WorkflowError("RECEIPT_MISMATCH", "Receipt depositor does not match the connected account.");
  }
  if (deposit.token !== expectedToken) {
    throw new WorkflowError("RECEIPT_MISMATCH", "Receipt token does not match the reviewed action.");
  }
  if (deposit.amount !== expectedAmount) {
    throw new WorkflowError("RECEIPT_MISMATCH", "Receipt amount does not match the reviewed action.");
  }
  const core = artifactCore({
    receipt: receiptInput,
    expectation,
    transactionHash: transactionHash as `0x${string}`,
    blockNumber: receiptInput.block_number,
    blockHash,
    account: expectedAccount,
    token: expectedToken,
    amount: expectedAmount.toString(10),
    pool,
  });
  return {
    ...core,
    receiptId: await workflowSha256(core),
  };
}
