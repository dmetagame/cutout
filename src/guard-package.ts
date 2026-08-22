import { CUTOUT_MODEL, CUTOUT_MODEL_V1_4 } from "./engine/constants.js";
import type { Band, Decision, SignalResult } from "./engine/types.js";
import type {
  AvailablePreflightApiResponse,
  PreflightApiErrorCode,
  PreflightApiResponse,
  UnavailablePreflightApiResponse,
  WireCohortQuality,
  WireExactFlexibility,
  WireFlexibleFlexibility,
  WireIntent,
  WireRecommendation,
  WireShieldIntent,
  WireWithdrawIntent,
} from "./api/types.js";
import {
  MAINNET_TOKENS,
  SN_MAIN_CHAIN_ID,
  STRK20_POOL_ADDRESS,
  STRK20_POOL_DEPLOYMENT_BLOCK,
  mainnetConfig,
} from "./starknet/config.js";
import { FRESHNESS_POLICY, GUARD_POLICY } from "./starknet/policies.js";
import {
  assertGuardedDepositPlan,
  assertSubmissionAuthorization,
  authorizeSubmission,
  createGuardedDepositPlan as createInternalGuardedDepositPlan,
  decisionAllowsWalletCall,
  makeFinalExactIntent,
  validateSimulationEvidence,
  validateSingleDepositAction,
} from "./workflow/guard.js";
import {
  parsePreflightApiResponse,
  requestPreflight,
} from "./workflow/preflight-client.js";
import type {
  PreflightClientFailure,
  PreflightClientFailureCode,
  PreflightClientResult,
  PreflightFetch,
  PreflightFetchResponse,
} from "./workflow/preflight-client.js";
import { verifyDepositReceipt } from "./workflow/receipt.js";
import {
  formatTokenAmount,
  parseBaseUnitAmount,
  parseTokenAmount,
} from "./workflow/amounts.js";
import {
  RECEIPT_SCHEMA_VERSION,
  WorkflowError,
} from "./workflow/types.js";
import type {
  CutoutReceiptArtifact,
  DepositAction,
  ExecutionSelection,
  GuardedDepositPlan,
  PublicReceiptEvent,
  PublicSnapshotBoundary,
  PublicTransactionReceipt,
  ReceiptExpectation,
  SigningDecisionInput,
  SimulatedDepositPlan,
  SubmissionAuthorization,
  WalletRuntimeIdentity,
  WalletSimulationEvidence,
  WorkflowErrorCode,
} from "./workflow/types.js";

export const CUTOUT_GUARD_API_VERSION = "CUTOUT_GUARD_API-v1" as const;

export const CUTOUT_VERSIONS = Object.freeze({
  packageApi: CUTOUT_GUARD_API_VERSION,
  model: CUTOUT_MODEL_V1_4.version,
  replayModel: CUTOUT_MODEL.version,
  supportedModels: Object.freeze([CUTOUT_MODEL.version, CUTOUT_MODEL_V1_4.version] as const),
  guardPolicy: GUARD_POLICY.version,
  freshnessPolicy: FRESHNESS_POLICY.version,
  receiptSchema: RECEIPT_SCHEMA_VERSION,
});

export const CUTOUT_MAINNET = Object.freeze({
  chainId: SN_MAIN_CHAIN_ID,
  poolAddress: STRK20_POOL_ADDRESS,
  poolDeploymentBlock: STRK20_POOL_DEPLOYMENT_BLOCK,
  tokens: MAINNET_TOKENS.map((token) => Object.freeze({ ...token })),
});

const MAINNET_GUARD_CONFIG = mainnetConfig({});

/** Validate and bind one final mainnet deposit to fresh Cutout evidence. */
export function createGuardedDepositPlan(
  input: SigningDecisionInput,
): Promise<GuardedDepositPlan> {
  return createInternalGuardedDepositPlan(input, MAINNET_GUARD_CONFIG);
}

export {
  RECEIPT_SCHEMA_VERSION,
  WorkflowError,
  assertGuardedDepositPlan,
  assertSubmissionAuthorization,
  authorizeSubmission,
  decisionAllowsWalletCall,
  formatTokenAmount,
  makeFinalExactIntent,
  parseBaseUnitAmount,
  parsePreflightApiResponse,
  parseTokenAmount,
  requestPreflight,
  validateSimulationEvidence,
  validateSingleDepositAction,
  verifyDepositReceipt,
};

export type {
  AvailablePreflightApiResponse,
  Band,
  CutoutReceiptArtifact,
  Decision,
  DepositAction,
  ExecutionSelection,
  GuardedDepositPlan,
  PreflightApiErrorCode,
  PreflightApiResponse,
  PreflightClientFailure,
  PreflightClientFailureCode,
  PreflightClientResult,
  PreflightFetch,
  PreflightFetchResponse,
  PublicReceiptEvent,
  PublicSnapshotBoundary,
  PublicTransactionReceipt,
  ReceiptExpectation,
  SignalResult,
  SigningDecisionInput,
  SimulatedDepositPlan,
  SubmissionAuthorization,
  UnavailablePreflightApiResponse,
  WalletRuntimeIdentity,
  WalletSimulationEvidence,
  WireCohortQuality,
  WireExactFlexibility,
  WireFlexibleFlexibility,
  WireIntent,
  WireRecommendation,
  WireShieldIntent,
  WireWithdrawIntent,
  WorkflowErrorCode,
};
