export type SpikeErrorCode =
  | "UNSUPPORTED_ACTION"
  | "INVALID_INTENT"
  | "UNSUPPORTED_TOKEN"
  | "INVALID_AMOUNT"
  | "INVALID_AMOUNT_BOUNDS"
  | "INVALID_CHAIN"
  | "INVALID_ADDRESS"
  | "RPC_ERROR"
  | "RPC_DATA_STALE"
  | "INDEX_LAG_EXCEEDED"
  | "RPC_HEAD_INCONSISTENT"
  | "BLOCK_HASH_INCONSISTENT"
  | "PARENT_LINK_BROKEN"
  | "SOURCE_INCOMPLETE"
  | "UNKNOWN_EVENT_SELECTOR"
  | "EVENT_SCHEMA_INVALID"
  | "POOL_ABI_INVALID"
  | "POOL_ABI_MISMATCH"
  | "CHAIN_ID_MISMATCH"
  | "POOL_ADDRESS_MISMATCH"
  | "SNAPSHOT_INCOMPLETE"
  | "ENGINE_VERSION_MISMATCH"
  | "FRESHNESS_POLICY_VERSION_MISMATCH"
  | "UNSUPPORTED_WALLET"
  | "UNSUPPORTED_WALLET_API"
  | "WALLET_NETWORK_MISMATCH"
  | "WALLET_NOT_CONNECTED"
  | "BROWSER_CONTEXT_UNAVAILABLE"
  | "WALLET_CONNECTION_FAILED"
  | "WALLET_SIMULATION_FAILED";

export class SpikeError extends Error {
  readonly code: SpikeErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean>> | undefined;

  constructor(
    code: SpikeErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean>>,
  ) {
    super(message);
    this.name = "SpikeError";
    this.code = code;
    this.details = details;
  }
}

export function spikeErrorCode(error: unknown): SpikeErrorCode | "UNKNOWN" {
  return error instanceof SpikeError ? error.code : "UNKNOWN";
}
