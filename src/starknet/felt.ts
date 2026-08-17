import { validateAndParseAddress } from "starknet";
import type { Address, TransactionHash } from "../engine/types.js";
import { SpikeError } from "./errors.js";

const MAX_U128 = (1n << 128n) - 1n;

export function normalizeFelt(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new SpikeError("INVALID_INTENT", `${field} must be a hexadecimal felt.`);
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("negative");
    return `0x${parsed.toString(16)}`;
  } catch {
    throw new SpikeError("INVALID_INTENT", `${field} is not a valid felt.`);
  }
}

export function normalizeAddress(value: unknown, field = "address"): Address {
  if (typeof value !== "string") {
    throw new SpikeError("INVALID_ADDRESS", `${field} must be a Starknet address.`);
  }
  try {
    return validateAndParseAddress(value).toLowerCase() as Address;
  } catch {
    throw new SpikeError("INVALID_ADDRESS", `${field} is not a valid Starknet address.`);
  }
}

export function normalizeTransactionHash(
  value: unknown,
  field = "transaction hash",
): TransactionHash {
  return normalizeFelt(value, field) as TransactionHash;
}

export function parseU128(value: unknown, field: string): bigint {
  const felt = normalizeFelt(value, field);
  const amount = BigInt(felt);
  if (amount > MAX_U128) {
    throw new SpikeError("EVENT_SCHEMA_INVALID", `${field} exceeds u128.`);
  }
  return amount;
}

export function amountToFelt(amount: bigint): string {
  return `0x${amount.toString(16)}`;
}

export function isPositiveU128(amount: unknown): amount is bigint {
  return typeof amount === "bigint" && amount > 0n && amount <= MAX_U128;
}

export { MAX_U128 };
