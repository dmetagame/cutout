import type { Decision } from "../engine/types.js";
import type { PreflightApiResponse, WireShieldIntent } from "../api/types.js";

export type WorkflowErrorCode =
  | "INVALID_INTENT"
  | "UNSUPPORTED_ACTION"
  | "UNSUPPORTED_TOKEN"
  | "INVALID_AMOUNT"
  | "INVALID_FLEXIBILITY"
  | "RECOMMENDATION_UNAVAILABLE"
  | "RECOMMENDATION_OUT_OF_BOUNDS"
  | "RECOMMENDATION_MISMATCH"
  | "PREFLIGHT_UNAVAILABLE"
  | "STALE_PREFLIGHT"
  | "SNAPSHOT_HASH_MISMATCH"
  | "MODEL_VERSION_MISMATCH"
  | "GUARD_POLICY_MISMATCH"
  | "DECISION_ID_MISMATCH"
  | "GUARD_DENIED"
  | "WALLET_NOT_CONNECTED"
  | "WALLET_NETWORK_MISMATCH"
  | "UNSUPPORTED_WALLET_API"
  | "ACCOUNT_MISMATCH"
  | "DISPLAYED_AMOUNT_MISMATCH"
  | "SIMULATION_REQUIRED"
  | "SIMULATION_MISMATCH"
  | "USER_APPROVAL_REQUIRED"
  | "WARNING_ACKNOWLEDGEMENT_REQUIRED"
  | "RECEIPT_MISMATCH";

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;

  constructor(code: WorkflowErrorCode, message: string) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
  }
}

export interface PublicSnapshotBoundary {
  readonly chainId: string;
  readonly poolAddress: string;
  readonly observedBlock: number;
  readonly observedBlockHash: string;
  readonly observedTimestamp: number;
  readonly indexedThroughBlock: number;
  readonly indexedThroughHash: string;
  readonly indexedThroughTimestamp: number;
  readonly rpcHeadBlock: number;
  readonly rpcHeadHash: string;
  readonly rpcHeadTimestamp: number;
  readonly snapshotHash: `0x${string}`;
  readonly engineVersion: string;
  readonly freshnessPolicyVersion: string;
  readonly guardPolicyVersion: string;
}

export interface WalletRuntimeIdentity {
  readonly chainId: string;
  readonly accountAddress: string;
  readonly selectedApiVersion: string;
}

export interface ExecutionSelection {
  readonly source: "ORIGINAL" | "RECOMMENDATION";
  readonly action: "shield";
  readonly token: string;
  readonly amount: string;
}

export interface DepositAction {
  readonly type: "deposit";
  readonly token: string;
  readonly amount: string;
}

export interface GuardedDepositPlan {
  readonly status: "VALIDATED";
  readonly originalIntent: WireShieldIntent;
  readonly finalIntent: WireShieldIntent;
  readonly selection: ExecutionSelection;
  readonly action: DepositAction;
  readonly displayedAmount: string;
  readonly chainId: string;
  readonly poolAddress: string;
  readonly account: string;
  readonly snapshotHash: `0x${string}`;
  readonly decisionId: `0x${string}`;
  readonly modelVersion: string;
  readonly guardPolicyVersion: string;
  readonly decision: Decision;
  readonly riskBand: "LOW" | "MEDIUM" | "HIGH";
  readonly warningAcknowledgementRequired: boolean;
  readonly indexedThroughTimestamp: number;
}

export interface WalletSimulationEvidence {
  readonly status: "SIMULATED";
  readonly simulateFlag: true;
  readonly contractAddress: string;
  readonly entryPoint: string;
  readonly calldataLength: number;
  readonly proofEmpty: true;
}

export interface SimulatedDepositPlan {
  readonly status: "SIMULATED";
  readonly plan: GuardedDepositPlan;
  readonly simulation: WalletSimulationEvidence;
  readonly actionBinding: string;
}

export interface SubmissionAuthorization {
  readonly status: "AUTHORIZED";
  readonly action: DepositAction;
  readonly actionBinding: string;
  readonly chainId: string;
  readonly poolAddress: string;
  readonly account: string;
  readonly snapshotHash: `0x${string}`;
  readonly decisionId: `0x${string}`;
  readonly modelVersion: string;
  readonly guardPolicyVersion: string;
  readonly decision: Decision;
  readonly recommendationStatus: "ORIGINAL" | "ACCEPTED";
  readonly authorizedAt: number;
  readonly explicitUserApproval: true;
}

export interface SigningDecisionInput {
  readonly originalIntent: WireShieldIntent;
  readonly initialPreflight: PreflightApiResponse;
  readonly selection: ExecutionSelection;
  readonly displayedAmount: string;
  readonly finalIntent: WireShieldIntent;
  readonly finalPreflight: PreflightApiResponse;
  readonly snapshot: PublicSnapshotBoundary;
  readonly wallet: WalletRuntimeIdentity;
  readonly now: number;
}

export interface PublicReceiptEvent {
  readonly from_address: unknown;
  readonly keys: unknown;
  readonly data: unknown;
}

export interface PublicTransactionReceipt {
  readonly transaction_hash?: unknown;
  readonly block_number?: unknown;
  readonly block_hash?: unknown;
  readonly finality_status?: unknown;
  readonly execution_status?: unknown;
  readonly events?: unknown;
}

export const RECEIPT_SCHEMA_VERSION = "CUTOUT_RECEIPT-v1" as const;

export interface CutoutReceiptArtifact {
  readonly schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  readonly transactionHash: `0x${string}`;
  readonly chainId: string;
  readonly pool: string;
  readonly token: string;
  readonly amount: string;
  readonly account: string;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly observedSnapshotHash: `0x${string}`;
  readonly engineVersion: string;
  readonly guardPolicyVersion: string;
  readonly decision: Decision;
  readonly selectedAmount: string;
  readonly recommendationStatus: "ORIGINAL" | "ACCEPTED";
  readonly timestamp: number;
  readonly receiptId: `0x${string}`;
}

export interface ReceiptExpectation {
  readonly transactionHash: string;
  readonly chainId: string;
  readonly poolAddress: string;
  readonly depositSelector: string;
  readonly token: string;
  readonly amount: string;
  readonly account: string;
  readonly observedSnapshotHash: `0x${string}`;
  readonly engineVersion: string;
  readonly guardPolicyVersion: string;
  readonly decision: Decision;
  readonly recommendationStatus: "ORIGINAL" | "ACCEPTED";
  readonly timestamp: number;
}
