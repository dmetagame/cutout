import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.CUTOUT_E2E_PORT ?? "3005");
if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new Error("CUTOUT_E2E_PORT must be an integer between 1 and 65535.");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["line"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run web:dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CUTOUT_DB_PATH: "data/milestone3-fixture.sqlite",
      CUTOUT_FIXED_NOW: "2000000000",
      CUTOUT_FIXTURE_MODEL_VERSION: "CUTOUT-v1.4",
      CUTOUT_RUNTIME_MODE: "fixture",
      CUTOUT_BROWSER_RPC_URL: "https://cutout-rpc.invalid",
    },
  },
});
