import type { PublicSnapshotBoundary } from "@cutout/workflow/types";
import type { PublicCover } from "@cutout/cover";

export interface WebToken {
  readonly address: string;
  readonly symbol: "USDC" | "STRK" | "ETH" | "strkBTC";
  readonly decimals: number;
}

export interface BrowserCutoutConfig {
  readonly chainId: string;
  readonly rpcUrl: string;
  readonly poolAddress: string;
  readonly poolDeploymentBlock: number;
  readonly maxEventRangeBlocks: number;
  readonly tokens: readonly WebToken[];
}

export interface AvailableWebBootstrap {
  readonly status: "AVAILABLE";
  readonly runtimeMode: "MAINNET" | "FIXTURE";
  readonly serverNow: number;
  readonly config: BrowserCutoutConfig;
  readonly snapshot: PublicSnapshotBoundary;
  readonly depositSelector: string;
  readonly withdrawalSelector: string;
  readonly cover: PublicCover;
}

export interface UnavailableWebBootstrap {
  readonly status: "UNAVAILABLE";
  readonly runtimeMode: "MAINNET" | "FIXTURE";
  readonly serverNow: number;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type WebBootstrap = AvailableWebBootstrap | UnavailableWebBootstrap;
