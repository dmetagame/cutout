import { DEFAULT_RPC_URL } from "../starknet/config.js";

/** The fallback is centralised here; production values are always environment-configured. */
export const DEFAULT_SECONDARY_RPC_URL = "https://api.cartridge.gg/x/starknet/mainnet";

export interface OperationalRpcConfig {
  readonly primaryUrl: string;
  readonly secondaryUrl: string;
  readonly timeoutMs: number;
  readonly initialBackoffMs: number;
  readonly maximumBackoffMs: number;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function rpcUrl(value: string, name: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    return parsed.toString();
  } catch {
    throw new Error(`${name} must be an HTTP(S) URL.`);
  }
}

export function operationalRpcConfig(
  env: NodeJS.ProcessEnv = process.env,
): OperationalRpcConfig {
  const primaryUrl = rpcUrl(
    env.CUTOUT_RPC_PRIMARY_URL ?? env.RPC_URL ?? DEFAULT_RPC_URL,
    "CUTOUT_RPC_PRIMARY_URL",
  );
  const secondaryUrl = rpcUrl(
    env.CUTOUT_RPC_SECONDARY_URL ?? DEFAULT_SECONDARY_RPC_URL,
    "CUTOUT_RPC_SECONDARY_URL",
  );
  if (primaryUrl === secondaryUrl) {
    throw new Error("Primary and secondary Starknet RPC URLs must differ.");
  }
  const initialBackoffMs = positiveInteger(
    env.CUTOUT_RETRY_INITIAL_MS,
    1_000,
    "CUTOUT_RETRY_INITIAL_MS",
  );
  const maximumBackoffMs = positiveInteger(
    env.CUTOUT_RETRY_MAX_MS,
    30_000,
    "CUTOUT_RETRY_MAX_MS",
  );
  if (maximumBackoffMs < initialBackoffMs) {
    throw new Error("CUTOUT_RETRY_MAX_MS must be greater than or equal to CUTOUT_RETRY_INITIAL_MS.");
  }
  return {
    primaryUrl,
    secondaryUrl,
    timeoutMs: positiveInteger(env.CUTOUT_RPC_TIMEOUT_MS, 12_000, "CUTOUT_RPC_TIMEOUT_MS"),
    initialBackoffMs,
    maximumBackoffMs,
  };
}
