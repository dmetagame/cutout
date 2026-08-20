import { createPreflightHttpServer } from "../src/api/http.js";
import { PreflightService } from "../src/api/preflight.js";
import { CanonicalStore } from "../src/indexer/store.js";
import { buildOperationalHealthReport } from "../src/operations/health.js";
import { processOperationalMetrics } from "../src/operations/metrics.js";
import { loadPoolAbiFixture, reviewPoolAbi } from "../src/starknet/abi.js";
import { mainnetConfig } from "../src/starknet/config.js";

const config = mainnetConfig();
const fixture = await loadPoolAbiFixture();
const abi = reviewPoolAbi(fixture);
const databasePath = process.env.CUTOUT_DB_PATH ?? "data/cutout.sqlite";
const port = Number(process.env.PORT ?? "8787");
if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const store = new CanonicalStore({ path: databasePath, config, abi, readOnly: true });
const service = new PreflightService(store, config, abi);
const metrics = processOperationalMetrics();
const server = createPreflightHttpServer(
  service,
  (entry) => {
    metrics.recordPreflight(entry.durationMs, entry.status !== "AVAILABLE");
    console.log(JSON.stringify(entry));
  },
  () => {
    const report = buildOperationalHealthReport({
      store,
      config,
      abi,
      now: () => Math.floor(Date.now() / 1_000),
      apiMetrics: metrics.snapshot(),
    });
    return { statusCode: report.ready ? 200 : 503, body: report };
  },
);

server.listen(port, "127.0.0.1", () => {
  console.log(`Cutout preflight API listening at http://127.0.0.1:${port}/api/preflight`);
});

function close(): void {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
