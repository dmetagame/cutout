import { CUTOUT_MODEL } from "../engine/constants.js";
import type { Address } from "../engine/types.js";
import { DataLayerError } from "../indexer/errors.js";
import type { CanonicalStore } from "../indexer/store.js";
import type {
  IndexerState,
  OperationalHealthStatus,
  RpcProviderName,
  RpcProviderState,
} from "../indexer/types.js";
import type { ReviewedPoolAbi } from "../starknet/abi.js";
import type { StarknetSpikeConfig } from "../starknet/config.js";
import { SpikeError } from "../starknet/errors.js";
import { validatePublicSnapshot } from "../starknet/freshness.js";
import { FRESHNESS_POLICY, GUARD_POLICY } from "../starknet/policies.js";
import { hashPublicSnapshot } from "../starknet/snapshot.js";
import type { PublicSnapshot, SpikeShieldIntent } from "../starknet/types.js";
import type { ApiOperationalMetrics } from "./metrics.js";

export type SnapshotOperationalStatus =
  | "CURRENT_COMPLETE_SNAPSHOT"
  | "STALE_SNAPSHOT"
  | "NO_USABLE_SNAPSHOT";

export interface OperationalHealthReport {
  readonly status: OperationalHealthStatus;
  readonly ready: boolean;
  readonly observedAt: number;
  readonly api: { readonly status: "HEALTHY" };
  readonly indexer: {
    readonly status: OperationalHealthStatus;
    readonly internalStatus: IndexerState["status"];
    readonly indexedThroughBlock: number | null;
    readonly lastSuccessfulBlock: number | null;
    readonly lastSuccessfulSync: number | null;
    readonly lastErrorCode: string | null;
    readonly lastErrorTimestamp: number | null;
    readonly activeRpcProvider: RpcProviderName | null;
  };
  readonly database: {
    readonly status: "HEALTHY";
    readonly integrity: "ok";
    readonly mode: "read-only" | "read-write";
  };
  readonly rpc: {
    readonly primary: RpcProviderState;
    readonly secondary: RpcProviderState;
    readonly currentHeadBlock: number | null;
    readonly currentHeadHash: string | null;
    readonly currentHeadTimestamp: number | null;
  };
  readonly snapshot: {
    readonly status: SnapshotOperationalStatus;
    readonly reasonCode: string | null;
    readonly snapshotHash: string | null;
    readonly blockNumber: number | null;
    readonly blockHash: string | null;
    readonly observedTimestamp: number | null;
    readonly indexedThroughBlock: number | null;
    readonly sourceAgeSeconds: number | null;
    readonly indexLagSeconds: number | null;
  };
  readonly versions: {
    readonly model: string;
    readonly freshnessPolicy: string;
    readonly guardPolicy: string;
  };
  readonly metrics: {
    readonly indexer: {
      readonly lastSyncDurationMs: number | null;
      readonly lastIngestionBatchDurationMs: number | null;
      readonly lastSnapshotDurationMs: number | null;
      readonly rpcFailureCount: number;
      readonly rpcFailoverCount: number;
      readonly indexLagSeconds: number | null;
    };
    readonly apiProcess: ApiOperationalMetrics;
  };
}

function emptyProvider(provider: RpcProviderName): RpcProviderState {
  return {
    provider,
    status: "UNAVAILABLE",
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastErrorCode: "NOT_YET_CHECKED",
    chainId: null,
    headBlock: null,
    headHash: null,
    headTimestamp: null,
  };
}

function validationIntent(
  snapshot: PublicSnapshot,
  config: StarknetSpikeConfig,
  now: number,
): SpikeShieldIntent {
  const token = config.tokens[0]?.address;
  if (token === undefined) {
    throw new DataLayerError("INDEX_CORRUPT", "No supported token is configured for health validation.");
  }
  return {
    action: "shield",
    chainId: config.chainId,
    account: "0x1" as Address,
    token,
    amount: 1n,
    evaluationBlock: snapshot.observedBlock,
    evaluationTimestamp: now,
    flexibility: { mode: "exact" },
    deadline: now + 60,
  };
}

function healthErrorCode(error: unknown): string {
  if (error instanceof DataLayerError || error instanceof SpikeError) return error.code;
  return "SNAPSHOT_UNAVAILABLE";
}

function isStaleCode(code: string): boolean {
  return code === "RPC_DATA_STALE" || code === "INDEX_LAG_EXCEEDED" || code === "STALE_RPC" || code === "INDEX_LAG";
}

function operationalStatus(
  state: IndexerState,
  snapshotStatus: SnapshotOperationalStatus,
  providers: readonly RpcProviderState[],
  now: number,
): OperationalHealthStatus {
  if (state.status === "REORGING") return "REORG_RECOVERY";
  if (state.lastErrorCode === "POOL_SCHEMA_MISMATCH" && state.status === "ERROR") {
    return "SCHEMA_MISMATCH";
  }
  if (state.status === "ERROR" || state.status === "EMPTY") return "UNAVAILABLE";
  if (state.status !== "COMPLETE" || snapshotStatus !== "CURRENT_COMPLETE_SNAPSHOT") {
    return snapshotStatus === "NO_USABLE_SNAPSHOT" ? "UNAVAILABLE" : "DEGRADED";
  }
  const providersCurrent = providers.every(
    (provider) =>
      provider.status === "HEALTHY" &&
      provider.lastCheckedAt !== null &&
      now - provider.lastCheckedAt <= FRESHNESS_POLICY.maximumSourceAgeSeconds,
  );
  return providersCurrent ? "HEALTHY" : "DEGRADED";
}

export function buildOperationalHealthReport(input: {
  readonly store: CanonicalStore;
  readonly config: StarknetSpikeConfig;
  readonly abi: ReviewedPoolAbi;
  readonly now: number;
  readonly apiMetrics: ApiOperationalMetrics;
}): OperationalHealthReport {
  const { store, config, abi, now, apiMetrics } = input;
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new DataLayerError("INDEX_CORRUPT", "Health evaluation timestamp is invalid.");
  }
  if (store.databaseIntegrity() !== "ok") {
    throw new DataLayerError("INDEX_CORRUPT", "SQLite integrity check failed.");
  }
  const state = store.getState();
  const providerRows = store.getRpcProviderStates();
  const primary = providerRows.find((provider) => provider.provider === "primary") ?? emptyProvider("primary");
  const secondary = providerRows.find((provider) => provider.provider === "secondary") ?? emptyProvider("secondary");
  const providers = [primary, secondary] as const;

  let latest: PublicSnapshot | null = null;
  let current: PublicSnapshot | null = null;
  let snapshotStatus: SnapshotOperationalStatus = "NO_USABLE_SNAPSHOT";
  let reasonCode: string | null = "SNAPSHOT_UNAVAILABLE";
  try {
    latest = store.loadLatestPersistedSnapshot();
  } catch (error) {
    reasonCode = healthErrorCode(error);
  }
  if (latest !== null) {
    snapshotStatus = "STALE_SNAPSHOT";
    reasonCode = state.status === "COMPLETE" ? "SNAPSHOT_UNAVAILABLE" : `INDEXER_${state.status}`;
    try {
      current = store.loadCompleteSnapshot();
      validatePublicSnapshot(current, validationIntent(current, config, now), config, abi);
      snapshotStatus = "CURRENT_COMPLETE_SNAPSHOT";
      reasonCode = null;
    } catch (error) {
      const code = healthErrorCode(error);
      reasonCode = code;
      snapshotStatus = isStaleCode(code) || state.status !== "COMPLETE"
        ? "STALE_SNAPSHOT"
        : "NO_USABLE_SNAPSHOT";
    }
  }

  const snapshot = current ?? latest;
  const sourceAgeSeconds = snapshot === null ? null : now - snapshot.indexedThroughTimestamp;
  const indexLagSeconds = snapshot === null
    ? null
    : snapshot.rpcHeadTimestamp - snapshot.indexedThroughTimestamp;
  const indexerStatus = operationalStatus(state, snapshotStatus, providers, now);
  const ready =
    (indexerStatus === "HEALTHY" || indexerStatus === "DEGRADED") &&
    snapshotStatus === "CURRENT_COMPLETE_SNAPSHOT";
  return {
    status: indexerStatus,
    ready,
    observedAt: now,
    api: { status: "HEALTHY" },
    indexer: {
      status: indexerStatus,
      internalStatus: state.status,
      indexedThroughBlock: state.indexedThroughBlock,
      lastSuccessfulBlock: state.lastSuccessfulBlock,
      lastSuccessfulSync: state.lastSuccessfulSyncAt,
      lastErrorCode: state.lastErrorCode,
      lastErrorTimestamp: state.lastErrorAt,
      activeRpcProvider: state.activeRpcProvider,
    },
    database: {
      status: "HEALTHY",
      integrity: "ok",
      mode: store.readOnly ? "read-only" : "read-write",
    },
    rpc: {
      primary,
      secondary,
      currentHeadBlock: snapshot?.rpcHeadBlock ?? null,
      currentHeadHash: snapshot?.rpcHeadHash ?? null,
      currentHeadTimestamp: snapshot?.rpcHeadTimestamp ?? null,
    },
    snapshot: {
      status: snapshotStatus,
      reasonCode,
      snapshotHash: snapshot === null ? null : hashPublicSnapshot(snapshot),
      blockNumber: snapshot?.observedBlock ?? null,
      blockHash: snapshot?.observedBlockHash ?? null,
      observedTimestamp: snapshot?.observedTimestamp ?? null,
      indexedThroughBlock: snapshot?.indexedThroughBlock ?? null,
      sourceAgeSeconds,
      indexLagSeconds,
    },
    versions: {
      model: CUTOUT_MODEL.version,
      freshnessPolicy: FRESHNESS_POLICY.version,
      guardPolicy: GUARD_POLICY.version,
    },
    metrics: {
      indexer: {
        lastSyncDurationMs: state.lastSyncDurationMs,
        lastIngestionBatchDurationMs: state.lastBatchDurationMs,
        lastSnapshotDurationMs: state.lastSnapshotDurationMs,
        rpcFailureCount: state.rpcFailureCount,
        rpcFailoverCount: state.rpcFailoverCount,
        indexLagSeconds,
      },
      apiProcess: apiMetrics,
    },
  };
}

export function unavailableOperationalHealthReport(
  now: number,
  errorCode: string,
  apiMetrics: ApiOperationalMetrics,
): Omit<OperationalHealthReport, "database" | "rpc" | "snapshot" | "indexer" | "metrics"> & {
  readonly status: "UNAVAILABLE";
  readonly ready: false;
  readonly errorCode: string;
  readonly metrics: { readonly apiProcess: ApiOperationalMetrics };
} {
  return {
    status: "UNAVAILABLE",
    ready: false,
    observedAt: now,
    errorCode,
    api: { status: "HEALTHY" },
    versions: {
      model: CUTOUT_MODEL.version,
      freshnessPolicy: FRESHNESS_POLICY.version,
      guardPolicy: GUARD_POLICY.version,
    },
    metrics: { apiProcess: apiMetrics },
  };
}
