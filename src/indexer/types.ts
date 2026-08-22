import type { ReviewedPoolAbi } from "../starknet/abi.js";
import type { StarknetSpikeConfig } from "../starknet/config.js";
import type { RpcBlockHeader, RpcEvent } from "../starknet/rpc.js";
import type {
  PublicDepositObservation,
  PublicRegistrationObservation,
  PublicSnapshot,
  PublicWithdrawalObservation,
  SnapshotHash,
} from "../starknet/types.js";

export type IndexerStatus =
  | "EMPTY"
  | "SYNCING"
  | "REORGING"
  | "COMPLETE"
  | "ERROR";

export type OperationalHealthStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "REORG_RECOVERY"
  | "SCHEMA_MISMATCH";

export type RpcProviderName = "primary" | "secondary";

export type IndexerModelVersion = "CUTOUT-v1.3" | "CUTOUT-v1.4";

export type RpcProviderHealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

export interface RpcProviderState {
  readonly provider: RpcProviderName;
  readonly status: RpcProviderHealthStatus;
  readonly lastCheckedAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastErrorCode: string | null;
  readonly chainId: string | null;
  readonly headBlock: number | null;
  readonly headHash: string | null;
  readonly headTimestamp: number | null;
}

export interface IndexerState {
  readonly status: IndexerStatus;
  readonly modelVersion: IndexerModelVersion;
  readonly chainId: string;
  readonly poolAddress: string;
  readonly poolClassHash: string;
  readonly poolAbiFixtureVersion: string;
  readonly sourceFromBlock: number | null;
  readonly sourceFromHash: string | null;
  readonly sourceFromTimestamp: number | null;
  readonly requiredFromTimestamp: number | null;
  readonly indexedThroughBlock: number | null;
  readonly indexedThroughHash: string | null;
  readonly indexedThroughTimestamp: number | null;
  readonly activeSnapshotHash: SnapshotHash | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorAt: number | null;
  readonly lastSuccessfulSyncAt: number | null;
  readonly lastSuccessfulBlock: number | null;
  readonly lastSyncDurationMs: number | null;
  readonly lastBatchDurationMs: number | null;
  readonly lastSnapshotDurationMs: number | null;
  readonly rpcFailureCount: number;
  readonly rpcFailoverCount: number;
  readonly activeRpcProvider: RpcProviderName | null;
  readonly updatedAt: number;
}

export interface IndexedPoolEvent {
  readonly raw: RpcEvent;
  readonly eventOrdinal: number;
  readonly normalized:
    | { readonly kind: "deposit"; readonly observation: PublicDepositObservation }
    | { readonly kind: "withdrawal"; readonly observation: PublicWithdrawalObservation }
    | {
        readonly kind: "viewing-key-registration";
        readonly observation: PublicRegistrationObservation;
      };
  readonly rawPublicJson: string;
}

export interface IndexBatch {
  readonly fromBlock: number;
  readonly throughBlock: number;
  readonly fromHeader: RpcBlockHeader;
  readonly throughHeader: RpcBlockHeader;
  readonly headers: readonly RpcBlockHeader[];
  readonly events: readonly IndexedPoolEvent[];
  readonly eventPages: number;
}

export interface ReorgResult {
  readonly detected: boolean;
  readonly rolledBackToBlock: number | null;
  readonly fullReplay: boolean;
}

export interface IndexerSyncResult {
  readonly status: "COMPLETE";
  readonly snapshot: PublicSnapshot;
  readonly snapshotHash: SnapshotHash;
  readonly batchesCommitted: number;
  readonly eventPages: number;
  readonly reorg: ReorgResult;
  readonly metrics: {
    readonly syncDurationMs: number;
    readonly lastBatchDurationMs: number | null;
    readonly snapshotDurationMs: number;
  };
}

export interface IndexerOptions {
  readonly config: StarknetSpikeConfig;
  readonly abi: ReviewedPoolAbi;
  readonly maxRangeBlocks?: number;
  readonly reorgWindowBlocks?: number;
  readonly rpcProviderName?: RpcProviderName;
  readonly modelVersion?: IndexerModelVersion;
  readonly now?: () => number;
  readonly onProgress?: (message: string) => void;
}
