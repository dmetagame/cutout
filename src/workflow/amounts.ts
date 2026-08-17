import { WorkflowError } from "./types.js";

const MAX_U128 = (1n << 128n) - 1n;
const HUMAN_AMOUNT = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const BASE_UNIT_AMOUNT = /^[1-9][0-9]*$/;

export function parseBaseUnitAmount(value: unknown, field = "amount"): bigint {
  if (typeof value !== "string" || !BASE_UNIT_AMOUNT.test(value)) {
    throw new WorkflowError("INVALID_AMOUNT", `${field} must be a positive base-unit decimal string.`);
  }
  const amount = BigInt(value);
  if (amount <= 0n || amount > MAX_U128) {
    throw new WorkflowError("INVALID_AMOUNT", `${field} must fit a positive u128.`);
  }
  return amount;
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new WorkflowError("INVALID_AMOUNT", "Token decimal configuration is invalid.");
  }
  const normalized = value.trim();
  const match = HUMAN_AMOUNT.exec(normalized);
  if (match === null) {
    throw new WorkflowError("INVALID_AMOUNT", "Amount must be a plain positive decimal value.");
  }
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new WorkflowError("INVALID_AMOUNT", `Amount has more than ${decimals} decimal places.`);
  }
  const units = BigInt(whole) * (10n ** BigInt(decimals)) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (units <= 0n || units > MAX_U128) {
    throw new WorkflowError("INVALID_AMOUNT", "Amount must fit a positive u128 in base units.");
  }
  return units;
}

export function formatTokenAmount(value: string | bigint, decimals: number): string {
  const amount = typeof value === "bigint" ? value : parseBaseUnitAmount(value);
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new WorkflowError("INVALID_AMOUNT", "Token decimal configuration is invalid.");
  }
  if (decimals === 0) return amount.toString(10);
  const padded = amount.toString(10).padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

export function absoluteAmountDifference(left: bigint, right: bigint): bigint {
  return left >= right ? left - right : right - left;
}
