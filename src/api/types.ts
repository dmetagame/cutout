import type { Decision, SignalResult } from "../engine/types.js";
import type { SnapshotFreshness, SnapshotHash } from "../starknet/types.js";

export type PreflightApiErrorCode =
  | "INVALID_INTENT"
  | "UNSUPPORTED_ACTION"
  | "UNSUPPORTED_TOKEN"
  | "UNKNOWN_POOL"
  | "RPC_UNAVAILABLE"
  | "STALE_RPC"
  | "INDEX_LAG"
  | "INDEX_CORRUPT"
  | "INCONSISTENT_BLOCK_DATA"
  | "INSUFFICIENT_HISTORY"
  | "MODEL_VERSION_MISMATCH"
  | "POOL_SCHEMA_MISMATCH"
  | "SNAPSHOT_UNAVAILABLE";

export interface WireExactFlexibility {
  readonly mode: "exact";
}

export interface WireFlexibleFlexibility {
  readonly mode: "flexible";
  readonly min: string;
  readonly max: string;
}

export interface WireShieldIntent {
  readonly action: "shield";
  readonly chainId: string;
  readonly account: string;
  readonly token: string;
  readonly amount: string;
  readonly evaluationBlock: number;
  readonly evaluationTimestamp: number;
  readonly flexibility: WireExactFlexibility | WireFlexibleFlexibility;
  readonly deadline: number;
}

export interface WireCohortQuality {
  readonly existingMatches: number;
  readonly projectedCohort: number;
  readonly trafficEvents: number;
  readonly distinctAddresses: number;
  readonly distinctTransactions: number;
  readonly topAddressShare: number;
  readonly activeDays: number;
  readonly maxBurstShare: number;
  readonly healthy: boolean;
  readonly failures: readonly string[];
}

export type WireRecommendation =
  | {
      readonly kind: "CHANGE_AMOUNT";
      readonly from: string;
      readonly to: string;
      readonly absoluteDeviation: string;
      readonly cohort: WireCohortQuality;
    }
  | { readonly kind: "NO_SAFER_EXECUTION"; readonly reason: string }
  | null;

export interface AvailablePreflightApiResponse {
  readonly status: "AVAILABLE";
  readonly modelVersion: string;
  readonly guardPolicyVersion: string;
  readonly decision: Decision;
  readonly riskBand: "LOW" | "MEDIUM" | "HIGH";
  readonly signals: readonly SignalResult[];
  readonly candidateCohort: {
    readonly existingMatches: number;
    readonly projectedCohort: number;
  };
  readonly cohortQuality: WireCohortQuality;
  readonly recommendation: WireRecommendation;
  readonly freshness: SnapshotFreshness;
  readonly snapshotHash: SnapshotHash;
  readonly decisionId: `0x${string}`;
  readonly nonClaims: readonly string[];
}

export interface UnavailablePreflightApiResponse {
  readonly status: "NO_CONFIDENT_RECOMMENDATION";
  readonly modelVersion: string;
  readonly guardPolicyVersion: string;
  readonly error: {
    readonly code: PreflightApiErrorCode;
    readonly message: string;
  };
  readonly snapshotHash: SnapshotHash | null;
  readonly decisionId: `0x${string}`;
  readonly nonClaims: readonly string[];
}

export type PreflightApiResponse =
  | AvailablePreflightApiResponse
  | UnavailablePreflightApiResponse;
