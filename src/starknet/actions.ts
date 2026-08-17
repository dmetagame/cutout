import type { STRK20_DEPOSIT_ACTION } from "starknet";
import type { Address } from "../engine/types.js";
import type { StarknetSpikeConfig } from "./config.js";
import { tokenByAddress } from "./config.js";
import { SpikeError } from "./errors.js";
import {
  amountToFelt,
  isPositiveU128,
  normalizeAddress,
  normalizeFelt,
} from "./felt.js";
import type { IntentFlexibility, SpikeShieldIntent } from "./types.js";

const INTENT_KEYS = new Set([
  "action",
  "chainId",
  "account",
  "token",
  "amount",
  "evaluationBlock",
  "evaluationTimestamp",
  "flexibility",
  "deadline",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function noExtraKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseFlexibility(value: unknown, amount: bigint): IntentFlexibility {
  if (!isRecord(value) || typeof value.mode !== "string") {
    throw new SpikeError("INVALID_AMOUNT_BOUNDS", "Flexibility constraints are required.");
  }
  if (value.mode === "exact") {
    if (!noExtraKeys(value, new Set(["mode"]))) {
      throw new SpikeError("INVALID_AMOUNT_BOUNDS", "Exact flexibility has an invalid shape.");
    }
    return { mode: "exact" };
  }
  if (value.mode !== "flexible" || !noExtraKeys(value, new Set(["mode", "min", "max"]))) {
    throw new SpikeError("INVALID_AMOUNT_BOUNDS", "Flexible bounds have an invalid shape.");
  }
  if (!isPositiveU128(value.min) || !isPositiveU128(value.max)) {
    throw new SpikeError("INVALID_AMOUNT_BOUNDS", "Flexible bounds must be positive u128 values.");
  }
  if (value.min > amount || amount > value.max || value.min > value.max) {
    throw new SpikeError("INVALID_AMOUNT_BOUNDS", "Amount must be inside its permitted bounds.");
  }
  return { mode: "flexible", min: value.min, max: value.max };
}

export function validateShieldIntent(
  value: unknown,
  config: StarknetSpikeConfig,
): SpikeShieldIntent {
  if (!isRecord(value) || !noExtraKeys(value, INTENT_KEYS)) {
    throw new SpikeError("INVALID_INTENT", "Shield intent has an invalid shape.");
  }
  if (value.action !== "shield") {
    throw new SpikeError("UNSUPPORTED_ACTION", "Only a STRK20 shield/deposit is supported.");
  }
  const chainId = normalizeFelt(value.chainId, "intent chain id");
  if (chainId !== config.chainId) {
    throw new SpikeError("INVALID_CHAIN", "Shield intent targets the wrong Starknet network.");
  }
  const account = normalizeAddress(value.account, "intent account");
  const token = normalizeAddress(value.token, "intent token");
  if (tokenByAddress(config, token) === undefined) {
    throw new SpikeError("UNSUPPORTED_TOKEN", "Token is not configured for this STRK20 spike.");
  }
  if (!isPositiveU128(value.amount)) {
    throw new SpikeError("INVALID_AMOUNT", "Amount must be a positive u128 in base units.");
  }
  if (!validTimestamp(value.evaluationBlock)) {
    throw new SpikeError("INVALID_INTENT", "Evaluation block must be a non-negative integer.");
  }
  if (!validTimestamp(value.evaluationTimestamp) || !validTimestamp(value.deadline)) {
    throw new SpikeError("INVALID_INTENT", "Evaluation timestamp and deadline are required.");
  }
  if (value.deadline < value.evaluationTimestamp) {
    throw new SpikeError("INVALID_INTENT", "Shield intent deadline has already expired.");
  }
  const flexibility = parseFlexibility(value.flexibility, value.amount);
  return {
    action: "shield",
    chainId,
    account,
    token,
    amount: value.amount,
    evaluationBlock: value.evaluationBlock,
    evaluationTimestamp: value.evaluationTimestamp,
    flexibility,
    deadline: value.deadline,
  };
}

function amountAllowed(intent: SpikeShieldIntent, amount: bigint): boolean {
  if (intent.flexibility.mode === "exact") return amount === intent.amount;
  return amount >= intent.flexibility.min && amount <= intent.flexibility.max;
}

export function buildDepositAction(
  intentInput: unknown,
  config: StarknetSpikeConfig,
  selectedAmount?: bigint,
): STRK20_DEPOSIT_ACTION {
  const intent = validateShieldIntent(intentInput, config);
  const amount = selectedAmount ?? intent.amount;
  if (!isPositiveU128(amount)) {
    throw new SpikeError("INVALID_AMOUNT", "Selected deposit amount must be a positive u128.");
  }
  if (!amountAllowed(intent, amount)) {
    throw new SpikeError("INVALID_AMOUNT_BOUNDS", "Selected deposit amount exceeds user bounds.");
  }
  return {
    type: "deposit",
    token: intent.token,
    amount: amountToFelt(amount),
  };
}

export function supportedTokenAddress(
  config: StarknetSpikeConfig,
  symbol: string,
): Address | undefined {
  return config.tokens.find((token) => token.symbol === symbol)?.address;
}
