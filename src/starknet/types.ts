import type {
  Address,
  CohortQuality,
  Decision,
  DepositObservation,
  Recommendation,
  RegistrationObservation,
  SignalResult,
  TransactionHash,
  WithdrawalObservation,
} from "../engine/types.js";
import type { SpikeErrorCode } from "./errors.js";

export type SnapshotHash = `0x${string}`;

export interface BlockReference {
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly parentHash: string;
  readonly timestamp: number;
}

export interface PublicDepositObservation extends DepositObservation {
  readonly blockHash: string;
  readonly eventIndex: number;
  readonly eventId: string;
  readonly eventSelector: string;
  readonly normalizedFields: {
    readonly depositor: Address;
    readonly token: Address;
    readonly amount: string;
  };
}

export interface PublicRegistrationObservation extends RegistrationObservation {
  readonly blockHash: string;
  readonly eventIndex: number;
  readonly eventId: string;
  readonly eventSelector: string;
  readonly normalizedFields: {
    readonly account: Address;
  };
}

export interface PublicWithdrawalObservation extends WithdrawalObservation {
  readonly blockHash: string;
  readonly eventIndex: number;
  readonly eventId: string;
  readonly eventSelector: string;
  readonly normalizedFields: {
    readonly recipient: Address;
    readonly token: Address;
    readonly amount: string;
  };
}

export interface PublicSnapshot {
  readonly chainId: string;
  readonly poolAddress: Address;
  readonly poolClassHash: string;
  readonly poolAbiFixtureVersion: string;
  readonly observedBlock: number;
  readonly observedBlockHash: string;
  readonly observedTimestamp: number;
  readonly indexedThroughBlock: number;
  readonly indexedThroughHash: string;
  readonly indexedThroughTimestamp: number;
  readonly rpcHeadBlock: number;
  readonly rpcHeadHash: string;
  readonly rpcHeadTimestamp: number;
  readonly sourceFromBlock: number;
  readonly sourceFromHash: string;
  readonly sourceFromTimestamp: number;
  readonly requiredFromTimestamp: number;
  readonly sourceComplete: boolean;
  readonly pagesComplete: boolean;
  readonly queriedSelectors: readonly string[];
  readonly sourceParentBlock: number;
  readonly sourceParentHash: string;
  readonly sourceDeclaredParentHash: string;
  readonly blockReferences: readonly BlockReference[];
  readonly depositObservations: readonly PublicDepositObservation[];
  readonly withdrawalObservations?: readonly PublicWithdrawalObservation[];
  readonly viewingKeyRegistrationObservations: readonly PublicRegistrationObservation[];
  readonly engineVersion: string;
  readonly freshnessPolicyVersion: string;
}

export type IntentFlexibility =
  | { readonly mode: "exact" }
  | { readonly mode: "flexible"; readonly min: bigint; readonly max: bigint };

export interface SpikeShieldIntent {
  readonly action: "shield";
  readonly chainId: string;
  readonly account: Address;
  readonly token: Address;
  readonly amount: bigint;
  readonly evaluationBlock: number;
  readonly evaluationTimestamp: number;
  readonly flexibility: IntentFlexibility;
  readonly deadline: number;
}

export interface SpikeWithdrawIntent {
  readonly action: "withdraw";
  readonly chainId: string;
  readonly account: Address;
  readonly recipient: Address;
  readonly token: Address;
  readonly amount: bigint;
  readonly evaluationBlock: number;
  readonly evaluationTimestamp: number;
  readonly flexibility: IntentFlexibility;
  readonly deadline: number;
}

export interface SnapshotFreshness {
  readonly policyVersion: string;
  readonly maximumSourceAgeSeconds: 120;
  readonly maximumIndexLagSeconds: 120;
  readonly sourceAgeSeconds: number;
  readonly indexLagSeconds: number;
  readonly observedBlock: number;
  readonly indexedThroughBlock: number;
  readonly rpcHeadBlock: number;
  readonly sourceComplete: true;
}

export interface AvailableSpikePreflight {
  readonly status: "AVAILABLE";
  readonly modelVersion: string;
  readonly decision: Decision;
  readonly riskBand: "LOW" | "MEDIUM" | "HIGH";
  readonly signals: readonly SignalResult[];
  readonly candidateCohort: {
    readonly existingMatches: number;
    readonly projectedCohort: number;
  };
  readonly cohortQuality: CohortQuality;
  readonly recommendation: Recommendation | null;
  readonly snapshotHash: SnapshotHash;
  readonly freshness: SnapshotFreshness;
  readonly nonClaims: readonly string[];
}

export interface UnavailableSpikePreflight {
  readonly status: "NO_CONFIDENT_RECOMMENDATION";
  readonly modelVersion: string;
  readonly error: {
    readonly code: SpikeErrorCode | "UNKNOWN";
    readonly message: string;
  };
  readonly snapshotHash: SnapshotHash | null;
}

export type SpikePreflightResult = AvailableSpikePreflight | UnavailableSpikePreflight;

export interface NormalizedEventBase {
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly timestamp: number;
  readonly transactionHash: TransactionHash;
  readonly eventIndex: number;
  readonly eventId: string;
  readonly eventSelector: string;
}
