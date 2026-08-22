import { once } from "node:events";

import { createPreflightHttpServer } from "../src/api/http.js";
import { PreflightService } from "../src/api/preflight.js";
import type { PreflightApiResponse, WireShieldIntent } from "../src/api/types.js";
import { CUTOUT_MODEL_V1_4 } from "../src/engine/constants.js";
import { CanonicalStore } from "../src/indexer/store.js";
import { buildOperationalHealthReport } from "../src/operations/health.js";
import { processOperationalMetrics } from "../src/operations/metrics.js";
import { loadPoolAbiFixture, reviewPoolAbi } from "../src/starknet/abi.js";
import { mainnetConfig, tokenByAddress } from "../src/starknet/config.js";
import { FRESHNESS_POLICY, GUARD_POLICY } from "../src/starknet/policies.js";
import { hashPublicSnapshot } from "../src/starknet/snapshot.js";

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function closeServer(server: ReturnType<typeof createPreflightHttpServer>): Promise<void> {
  server.close();
  await once(server, "close");
}

async function main(): Promise<void> {
  const config = mainnetConfig();
  const abi = reviewPoolAbi(await loadPoolAbiFixture());
  const databasePath = process.env.CUTOUT_DB_PATH ?? "data/cutout-mainnet.sqlite";
  const now = Math.floor(Date.now() / 1_000);
  const metrics = processOperationalMetrics();
  const store = new CanonicalStore({
    path: databasePath,
    config,
    abi,
    readOnly: true,
    modelVersion: CUTOUT_MODEL_V1_4.version,
  });
  const server = createPreflightHttpServer(
    new PreflightService(store, config, abi, { now: () => now }),
    () => {},
    () => {
      const report = buildOperationalHealthReport({
        store,
        config,
        abi,
        now,
        apiMetrics: metrics.snapshot(),
      });
      return { statusCode: report.ready ? 200 : 503, body: report };
    },
  );

  try {
    const snapshot = store.loadCompleteSnapshot();
    const snapshotHash = hashPublicSnapshot(snapshot);
    const sample = [...snapshot.depositObservations]
      .reverse()
      .find((observation) => tokenByAddress(config, observation.token) !== undefined);
    if (sample === undefined) {
      throw new Error("No supported public Deposit observation is available for the smoke intent.");
    }
    const intent: WireShieldIntent = {
      action: "shield",
      chainId: config.chainId,
      account: "0x1",
      token: sample.token,
      amount: sample.amount.toString(10),
      evaluationBlock: snapshot.observedBlock,
      evaluationTimestamp: now,
      flexibility: { mode: "exact" },
      deadline: now + 600,
    };

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Smoke preflight server did not expose a local TCP address.");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const healthResponse = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
    const health = await healthResponse.json() as { readonly ready?: unknown };
    if (healthResponse.status !== 200 || health.ready !== true) {
      throw new Error(`Live health is unavailable (HTTP ${healthResponse.status}).`);
    }
    const response = await fetch(`${baseUrl}/api/preflight`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify(intent),
    });
    const preflight = await response.json() as PreflightApiResponse;
    if (
      response.status !== 200 ||
      preflight.status !== "AVAILABLE" ||
      preflight.snapshotHash !== snapshotHash ||
      preflight.modelVersion !== CUTOUT_MODEL_V1_4.version ||
      preflight.guardPolicyVersion !== GUARD_POLICY.version
    ) {
      throw new Error(`Live preflight failed closed (HTTP ${response.status}).`);
    }

    console.log("CUTOUT_M5_LIVE_SMOKE");
    console.log(stringify({
      status: "PASS",
      mode: "LIVE_MAINNET_NON_SUBMITTING",
      chainId: snapshot.chainId,
      poolAddress: snapshot.poolAddress,
      poolClassHash: snapshot.poolClassHash,
      token: sample.token,
      observedBlock: snapshot.observedBlock,
      observedBlockHash: snapshot.observedBlockHash,
      observedTimestamp: snapshot.observedTimestamp,
      indexedThroughBlock: snapshot.indexedThroughBlock,
      indexedThroughHash: snapshot.indexedThroughHash,
      indexedThroughTimestamp: snapshot.indexedThroughTimestamp,
      rpcHeadBlock: snapshot.rpcHeadBlock,
      rpcHeadHash: snapshot.rpcHeadHash,
      rpcHeadTimestamp: snapshot.rpcHeadTimestamp,
      indexLagSeconds: snapshot.rpcHeadTimestamp - snapshot.indexedThroughTimestamp,
      sourceAgeSeconds: now - snapshot.indexedThroughTimestamp,
      snapshotHash,
      versions: {
        model: CUTOUT_MODEL_V1_4.version,
        guardPolicy: GUARD_POLICY.version,
        freshnessPolicy: FRESHNESS_POLICY.version,
      },
      preflight,
      walletCapability: {
        status: "NOT_EXERCISED",
        reason: "The CLI smoke has no browser Wallet Standard context.",
      },
      simulation: {
        status: "NOT_RUN",
        reason: "Browser wallet simulation is verified separately and is never inferred from CLI output.",
      },
      broadcastMethodInvoked: false,
      transactionHashProduced: false,
      transactionSubmitted: false,
      historicalMilestone3Transaction: "0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e",
    }));
    console.log("NO TRANSACTION WAS SUBMITTED.");
  } finally {
    if (server.listening) await closeServer(server);
    store.close();
  }
}

main().catch((error: unknown) => {
  console.error(stringify({
    status: "FAILED_CLOSED",
    message: error instanceof Error ? error.message : String(error),
    broadcastMethodInvoked: false,
    transactionHashProduced: false,
    transactionSubmitted: false,
  }));
  console.error("NO TRANSACTION WAS SUBMITTED.");
  process.exitCode = 1;
});
