import type { Address } from "../engine/types.js";
import { normalizeAddress, normalizeFelt } from "./felt.js";
import { SpikeError } from "./errors.js";

export const SN_MAIN_CHAIN_ID = "0x534e5f4d41494e";
export const STRK20_POOL_ADDRESS = normalizeAddress(
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  "STRK20 pool address",
);
export const STRK20_POOL_DEPLOYMENT_BLOCK = 8_978_970;
export const DEFAULT_RPC_URL = "https://rpc.starknet.lava.build";

export interface SupportedToken {
  readonly address: Address;
  readonly symbol: "USDC" | "STRK" | "ETH" | "strkBTC";
  readonly decimals: number;
}

export const MAINNET_TOKENS: readonly SupportedToken[] = [
  {
    address: normalizeAddress(
      "0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
      "USDC address",
    ),
    symbol: "USDC",
    decimals: 6,
  },
  {
    address: normalizeAddress(
      "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      "STRK address",
    ),
    symbol: "STRK",
    decimals: 18,
  },
  {
    address: normalizeAddress(
      "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
      "ETH address",
    ),
    symbol: "ETH",
    decimals: 18,
  },
  {
    address: normalizeAddress(
      "0x787150e306e6eae6e3f79dea881770e8bbff2c1b8eb490f969669ee945b3135",
      "strkBTC address",
    ),
    symbol: "strkBTC",
    decimals: 8,
  },
];

export interface StarknetSpikeConfig {
  readonly chainId: string;
  readonly rpcUrl: string;
  readonly poolAddress: Address;
  readonly poolDeploymentBlock: number;
  readonly tokens: readonly SupportedToken[];
  readonly maxEventRangeBlocks: number;
}

export type CutoutEnvironment = Readonly<Record<string, string | undefined>>;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new SpikeError("INVALID_INTENT", "Range block configuration must be positive.");
  }
  return parsed;
}

export function mainnetConfig(env: CutoutEnvironment = process.env): StarknetSpikeConfig {
  const chainId = normalizeFelt(env.CHAIN_ID ?? SN_MAIN_CHAIN_ID, "chain id");
  const poolAddress = normalizeAddress(
    env.POOL_ADDRESS ?? STRK20_POOL_ADDRESS,
    "pool address",
  );
  if (chainId !== SN_MAIN_CHAIN_ID) {
    throw new SpikeError("INVALID_CHAIN", "This spike is configured for SN_MAIN only.");
  }
  if (poolAddress !== STRK20_POOL_ADDRESS) {
    throw new SpikeError("POOL_ADDRESS_MISMATCH", "This spike is configured for the STRK20 mainnet pool.");
  }
  return {
    chainId,
    rpcUrl: env.RPC_URL ?? DEFAULT_RPC_URL,
    poolAddress,
    poolDeploymentBlock: STRK20_POOL_DEPLOYMENT_BLOCK,
    tokens: MAINNET_TOKENS,
    maxEventRangeBlocks: positiveInteger(env.CUTOUT_RPC_RANGE_BLOCKS, 200_000),
  };
}

export function tokenByAddress(
  config: StarknetSpikeConfig,
  token: Address,
): SupportedToken | undefined {
  const normalized = normalizeAddress(token, "token");
  return config.tokens.find(
    (candidate) => normalizeAddress(candidate.address, "configured token") === normalized,
  );
}
