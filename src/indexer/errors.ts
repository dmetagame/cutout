import { SpikeError } from "../starknet/errors.js";

export type DataLayerErrorCode =
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

const DATA_LAYER_ERROR_CODES: ReadonlySet<string> = new Set([
  "UNKNOWN_POOL",
  "RPC_UNAVAILABLE",
  "STALE_RPC",
  "INDEX_LAG",
  "INDEX_CORRUPT",
  "INCONSISTENT_BLOCK_DATA",
  "INSUFFICIENT_HISTORY",
  "MODEL_VERSION_MISMATCH",
  "POOL_SCHEMA_MISMATCH",
  "SNAPSHOT_UNAVAILABLE",
]);

export function isDataLayerErrorCode(value: unknown): value is DataLayerErrorCode {
  return typeof value === "string" && DATA_LAYER_ERROR_CODES.has(value);
}

export class DataLayerError extends Error {
  readonly code: DataLayerErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean>> | undefined;

  constructor(
    code: DataLayerErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean>>,
  ) {
    super(message);
    this.name = "DataLayerError";
    this.code = code;
    this.details = details;
  }
}

export function asDataLayerError(
  error: unknown,
  fallback: DataLayerErrorCode = "INDEX_CORRUPT",
): DataLayerError {
  if (error instanceof DataLayerError) return error;
  if (
    error instanceof TypeError &&
    (error.message === "fetch failed" || error.message.includes("network"))
  ) {
    return new DataLayerError("RPC_UNAVAILABLE", error.message);
  }
  if (error instanceof SpikeError) {
    if (error.code === "RPC_ERROR") {
      return new DataLayerError("RPC_UNAVAILABLE", error.message);
    }
    if (error.code === "RPC_DATA_STALE") {
      return new DataLayerError("STALE_RPC", error.message);
    }
    if (error.code === "INDEX_LAG_EXCEEDED") {
      return new DataLayerError("INDEX_LAG", error.message);
    }
    if (
      error.code === "POOL_ABI_INVALID" ||
      error.code === "POOL_ABI_MISMATCH" ||
      error.code === "UNKNOWN_EVENT_SELECTOR" ||
      error.code === "EVENT_SCHEMA_INVALID"
    ) {
      return new DataLayerError("POOL_SCHEMA_MISMATCH", error.message);
    }
    if (
      error.code === "BLOCK_HASH_INCONSISTENT" ||
      error.code === "PARENT_LINK_BROKEN" ||
      error.code === "RPC_HEAD_INCONSISTENT" ||
      error.code === "CHAIN_ID_MISMATCH"
    ) {
      return new DataLayerError("INCONSISTENT_BLOCK_DATA", error.message);
    }
    if (error.code === "SOURCE_INCOMPLETE") {
      return new DataLayerError("INSUFFICIENT_HISTORY", error.message);
    }
    if (
      error.code === "ENGINE_VERSION_MISMATCH" ||
      error.code === "FRESHNESS_POLICY_VERSION_MISMATCH"
    ) {
      return new DataLayerError("MODEL_VERSION_MISMATCH", error.message);
    }
    if (error.code === "POOL_ADDRESS_MISMATCH") {
      return new DataLayerError("UNKNOWN_POOL", error.message);
    }
  }
  return new DataLayerError(
    fallback,
    error instanceof Error ? error.message : String(error),
  );
}
