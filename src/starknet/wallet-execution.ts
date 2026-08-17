import type { STRK20_DEPOSIT_ACTION } from "starknet";

import {
  assertGuardedDepositPlan,
  assertSubmissionAuthorization,
  validateSimulationEvidence,
  validateSingleDepositAction,
} from "../workflow/guard.js";
import type {
  GuardedDepositPlan,
  PublicTransactionReceipt,
  SimulatedDepositPlan,
  SubmissionAuthorization,
} from "../workflow/types.js";
import { normalizeTransactionHash } from "./felt.js";
import {
  prepareDepositSimulation,
  type WalletAccountV6Like,
} from "./wallet.js";

export type WalletExecutionFailureCode =
  | "UNSUPPORTED_WALLET_API"
  | "WALLET_SIMULATION_FAILED"
  | "WALLET_SUBMISSION_FAILED"
  | "USER_REJECTED"
  | "RECEIPT_UNAVAILABLE";

export interface WalletExecutionFailure {
  readonly status: "FAILED";
  readonly code: WalletExecutionFailureCode;
  readonly message: string;
}

export interface WalletSubmissionSuccess {
  readonly status: "SUBMITTED";
  readonly transactionHash: `0x${string}`;
}

export interface WalletReceiptSuccess {
  readonly status: "RECEIVED";
  readonly receipt: PublicTransactionReceipt;
}

export interface WalletExecutionAccountV6Like extends WalletAccountV6Like {
  strk20InvokeTransaction?(actions: STRK20_DEPOSIT_ACTION[]): Promise<{
    readonly transaction_hash: string;
  }>;
}

export interface PublicReceiptProviderLike {
  waitForTransaction(transactionHash: string): Promise<unknown>;
}

function failed(
  code: WalletExecutionFailureCode,
  message: string,
): WalletExecutionFailure {
  return { status: "FAILED", code, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function userRejected(error: unknown): boolean {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === 4001 || code === "USER_REJECTED" || code === "ACTION_REJECTED") return true;
  }
  return /reject|declin|cancel|denied/i.test(errorMessage(error));
}

export async function simulateGuardedDeposit(
  account: WalletExecutionAccountV6Like,
  plan: GuardedDepositPlan,
  now: number,
): Promise<SimulatedDepositPlan | WalletExecutionFailure> {
  assertGuardedDepositPlan(plan, now);
  const action = validateSingleDepositAction([plan.action], plan.action);
  const result = await prepareDepositSimulation(
    account,
    action as STRK20_DEPOSIT_ACTION,
  );
  if (result.status !== "SIMULATED") {
    return failed("WALLET_SIMULATION_FAILED", result.message);
  }
  try {
    return validateSimulationEvidence(plan, result);
  } catch (error) {
    return failed("WALLET_SIMULATION_FAILED", errorMessage(error));
  }
}

export async function submitAuthorizedDeposit(
  account: WalletExecutionAccountV6Like,
  authorization: SubmissionAuthorization,
): Promise<WalletSubmissionSuccess | WalletExecutionFailure> {
  assertSubmissionAuthorization(authorization);
  const action = validateSingleDepositAction([authorization.action], authorization.action);
  if (typeof account.strk20InvokeTransaction !== "function") {
    return failed(
      "UNSUPPORTED_WALLET_API",
      "Connected wallet does not expose STRK20 transaction submission.",
    );
  }
  try {
    const result = await account.strk20InvokeTransaction([
      action as STRK20_DEPOSIT_ACTION,
    ]);
    return {
      status: "SUBMITTED",
      transactionHash: normalizeTransactionHash(
        result.transaction_hash,
        "submitted transaction hash",
      ),
    };
  } catch (error) {
    if (userRejected(error)) {
      return failed("USER_REJECTED", "The wallet confirmation was rejected by the user.");
    }
    return failed("WALLET_SUBMISSION_FAILED", `Wallet submission failed: ${errorMessage(error)}`);
  }
}

export async function waitForGuardedReceipt(
  provider: PublicReceiptProviderLike,
  transactionHash: string,
): Promise<WalletReceiptSuccess | WalletExecutionFailure> {
  let normalizedHash: `0x${string}`;
  try {
    normalizedHash = normalizeTransactionHash(transactionHash, "transaction hash");
  } catch (error) {
    return failed("RECEIPT_UNAVAILABLE", errorMessage(error));
  }
  try {
    const result = await provider.waitForTransaction(normalizedHash);
    const receipt = (
      result !== null &&
      typeof result === "object" &&
      "value" in result &&
      (result as { readonly value?: unknown }).value !== undefined
    )
      ? (result as { readonly value: unknown }).value
      : result;
    if (receipt === null || typeof receipt !== "object") {
      return failed("RECEIPT_UNAVAILABLE", "Public RPC returned no transaction receipt.");
    }
    return {
      status: "RECEIVED",
      receipt: receipt as PublicTransactionReceipt,
    };
  } catch (error) {
    return failed("RECEIPT_UNAVAILABLE", `Receipt lookup failed: ${errorMessage(error)}`);
  }
}
