import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { CUTOUT_MODEL } from "@cutout/engine/constants";
import { DataLayerError } from "@cutout/indexer/errors";
import { CanonicalStore } from "@cutout/indexer/store";
import { loadPoolAbiFixture, reviewPoolAbi } from "@cutout/starknet/abi";
import {
  DEFAULT_RPC_URL,
  mainnetConfig,
} from "@cutout/starknet/config";
import { GUARD_POLICY } from "@cutout/starknet/policies";
import { hashPublicSnapshot } from "@cutout/starknet/snapshot";
import type { WebBootstrap } from "./types.js";

function repositoryRoot(): string {
  const current = process.cwd();
  if (existsSync(resolve(current, "fixtures/pool-abi.json"))) return current;
  const parent = resolve(current, "../..");
  if (existsSync(resolve(parent, "fixtures/pool-abi.json"))) return parent;
  throw new Error("Cutout repository root could not be resolved.");
}

export function runtimeNow(): number {
  if (process.env.NODE_ENV === "production") return Math.floor(Date.now() / 1_000);
  const fixed = process.env.CUTOUT_FIXED_NOW;
  if (fixed === undefined) return Math.floor(Date.now() / 1_000);
  const parsed = Number(fixed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("CUTOUT_FIXED_NOW must be a positive integer timestamp.");
  }
  return parsed;
}

export function runtimeMode(): "MAINNET" | "FIXTURE" {
  return process.env.CUTOUT_RUNTIME_MODE === "fixture" ? "FIXTURE" : "MAINNET";
}

export async function loadWebBootstrap(): Promise<WebBootstrap> {
  const now = runtimeNow();
  const mode = runtimeMode();
  try {
    const root = repositoryRoot();
    const config = mainnetConfig();
    const abi = reviewPoolAbi(await loadPoolAbiFixture(resolve(root, "fixtures/pool-abi.json")));
    const databasePath = resolve(root, process.env.CUTOUT_DB_PATH ?? "data/cutout.sqlite");
    const store = new CanonicalStore({ path: databasePath, config, abi, readOnly: true });
    try {
      const snapshot = store.loadCompleteSnapshot();
      return {
        status: "AVAILABLE",
        runtimeMode: mode,
        serverNow: now,
        config: {
          chainId: config.chainId,
          rpcUrl: process.env.CUTOUT_BROWSER_RPC_URL ?? DEFAULT_RPC_URL,
          poolAddress: config.poolAddress,
          poolDeploymentBlock: config.poolDeploymentBlock,
          maxEventRangeBlocks: config.maxEventRangeBlocks,
          tokens: config.tokens,
        },
        snapshot: {
          chainId: snapshot.chainId,
          poolAddress: snapshot.poolAddress,
          observedBlock: snapshot.observedBlock,
          observedBlockHash: snapshot.observedBlockHash,
          observedTimestamp: snapshot.observedTimestamp,
          indexedThroughBlock: snapshot.indexedThroughBlock,
          indexedThroughHash: snapshot.indexedThroughHash,
          indexedThroughTimestamp: snapshot.indexedThroughTimestamp,
          rpcHeadBlock: snapshot.rpcHeadBlock,
          rpcHeadHash: snapshot.rpcHeadHash,
          rpcHeadTimestamp: snapshot.rpcHeadTimestamp,
          snapshotHash: hashPublicSnapshot(snapshot),
          engineVersion: snapshot.engineVersion,
          freshnessPolicyVersion: snapshot.freshnessPolicyVersion,
          guardPolicyVersion: GUARD_POLICY.version,
        },
        depositSelector: abi.deposit.selector,
      };
    } finally {
      store.close();
    }
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      runtimeMode: mode,
      serverNow: now,
      error: {
        code: error instanceof DataLayerError ? error.code : "SNAPSHOT_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function openPreflightRuntime() {
  const root = repositoryRoot();
  const config = mainnetConfig();
  const abi = reviewPoolAbi(await loadPoolAbiFixture(resolve(root, "fixtures/pool-abi.json")));
  const databasePath = resolve(root, process.env.CUTOUT_DB_PATH ?? "data/cutout.sqlite");
  const store = new CanonicalStore({ path: databasePath, config, abi, readOnly: true });
  return { root, config, abi, store };
}

export async function openHealthRuntime() {
  const root = repositoryRoot();
  const config = mainnetConfig();
  const abi = reviewPoolAbi(await loadPoolAbiFixture(resolve(root, "fixtures/pool-abi.json")));
  const databasePath = resolve(root, process.env.CUTOUT_DB_PATH ?? "data/cutout.sqlite");
  const store = new CanonicalStore({ path: databasePath, config, abi, readOnly: true });
  return { root, config, abi, store };
}

export { CUTOUT_MODEL };
