import { loadPoolAbiFixture, reviewPoolAbi } from "../src/starknet/abi.js";
import { mainnetConfig } from "../src/starknet/config.js";
import { CUTOUT_MODEL_V1_4 } from "../src/engine/constants.js";
import { CanonicalStore } from "../src/indexer/store.js";
import { operationalRpcConfig } from "../src/operations/config.js";
import { IndexerSupervisor } from "../src/operations/indexer-supervisor.js";
import { createRpcFailoverManager } from "../src/operations/rpc-failover.js";

const DEFAULT_INTERVAL_SECONDS = 15;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Indexer interval must be a positive integer.");
  }
  return parsed;
}

const rpcConfig = operationalRpcConfig();
const config = mainnetConfig({ ...process.env, RPC_URL: rpcConfig.primaryUrl });
const fixture = await loadPoolAbiFixture();
const abi = reviewPoolAbi(fixture);
const databasePath = process.env.CUTOUT_DB_PATH ?? "data/cutout.sqlite";
const intervalSeconds = positiveInteger(
  process.env.CUTOUT_INDEX_INTERVAL_SECONDS,
  DEFAULT_INTERVAL_SECONDS,
);
const runOnce = process.argv.includes("--once");
const store = new CanonicalStore({
  path: databasePath,
  config,
  abi,
  modelVersion: CUTOUT_MODEL_V1_4.version,
});
const rpcManager = createRpcFailoverManager(rpcConfig, config.chainId, {
  onProviderState: (state) => store.recordRpcProviderState(state),
  onRpcFailure: () => store.recordRpcFailure(),
  onFailover: () => store.recordRpcFailover(),
});
const supervisor = new IndexerSupervisor({
  config,
  abi,
  store,
  intervalSeconds,
  initialBackoffMs: rpcConfig.initialBackoffMs,
  maximumBackoffMs: rpcConfig.maximumBackoffMs,
  modelVersion: CUTOUT_MODEL_V1_4.version,
  selectRpc: () => rpcManager.select(),
  onProgress: (message) => console.log(JSON.stringify({ event: "indexer", message })),
});

function stop(signal: "SIGINT" | "SIGTERM"): void {
  console.log(JSON.stringify({ event: "indexer_shutdown", signal }));
  supervisor.requestStop();
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

console.log(JSON.stringify({
  event: "indexer_start",
  mode: runOnce ? "once" : "continuous",
  databasePath,
  intervalSeconds,
  rpcTimeoutMs: rpcConfig.timeoutMs,
}));

try {
  const result = await supervisor.run({ once: runOnce });
  if (result.lastResult !== null) {
    console.log(JSON.stringify({
      event: "indexer_sync",
      status: result.lastResult.status,
      observedBlock: result.lastResult.snapshot.observedBlock,
      rpcHeadBlock: result.lastResult.snapshot.rpcHeadBlock,
      snapshotHash: result.lastResult.snapshotHash,
      batchesCommitted: result.lastResult.batchesCommitted,
      eventPages: result.lastResult.eventPages,
      reorg: result.lastResult.reorg,
      metrics: result.lastResult.metrics,
    }));
  }
  if (runOnce && result.lastErrorCode !== null) {
    console.error(JSON.stringify({
      event: "indexer_unavailable",
      errorCode: result.lastErrorCode,
    }));
    process.exitCode = 1;
  }
} finally {
  store.close();
}
