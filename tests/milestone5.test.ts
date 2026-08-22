import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("the integrator package manifest exposes only evidence entries and no application files", () => {
  const manifest = JSON.parse(read("packages/guard/package.json")) as {
    readonly name: string;
    readonly private?: boolean;
    readonly exports: Readonly<Record<string, unknown>>;
    readonly files: readonly string[];
  };
  assert.equal(manifest.name, "@cutout/guard");
  assert.notEqual(manifest.private, true);
  assert.deepEqual(Object.keys(manifest.exports), [".", "./react"]);
  assert.deepEqual(manifest.files, ["dist", "README.md"]);
});

test("the package entries cannot expose wallet execution, RPC, indexer, or database modules", () => {
  const entries = [read("src/guard-package.ts"), read("src/guard-react.tsx")];
  for (const forbidden of [
    "/indexer/",
    "/operations/",
    "/starknet/ingest",
    "/starknet/rpc",
    "/starknet/wallet",
    "wallet-execution",
    "strk20InvokeTransaction",
    "evaluatePreflight",
  ]) {
    for (const entry of entries) {
      assert.equal(entry.includes(forbidden), false, `${forbidden} leaked into a package entry`);
    }
  }
});

test("the live release smoke is public-data-only and cannot submit", () => {
  const smoke = read("scripts/release-smoke.ts");
  const spike = read("scripts/mainnet-spike.ts");
  for (const forbidden of [
    "wallet-execution",
    "WalletAccountV6",
    "strk20PrepareInvoke",
    "strk20InvokeTransaction",
    "privateKey",
    "seedPhrase",
    "viewingKey",
  ]) {
    assert.equal(smoke.includes(forbidden), false, `${forbidden} is forbidden in the CLI smoke`);
  }
  assert.match(smoke, /transactionSubmitted: false/);
  assert.match(smoke, /broadcastMethodInvoked: false/);
  assert.match(smoke, /modelVersion: CUTOUT_MODEL_V1_4\.version/);
  assert.equal(spike.includes("${config.rpcUrl}"), false);
  assert.match(spike, /URL redacted/);
});

test("historical receipt replay uses the independent public verifier without a wallet", () => {
  const verifier = read("scripts/verify-release-receipt.ts");
  assert.match(verifier, /verifyDepositReceipt/);
  assert.match(verifier, /starknet_getTransactionReceipt/);
  assert.equal(verifier.includes("wallet-execution"), false);
  assert.equal(verifier.includes("strk20InvokeTransaction"), false);
});

test("production configuration and containers keep secrets server-side and run unprivileged", () => {
  const environment = read(".env.example");
  const gitignore = read(".gitignore");
  const dockerignore = read(".dockerignore");
  const dockerfile = read("Dockerfile");
  const compose = read("compose.yaml");
  const ci = read(".github/workflows/ci.yml");
  assert.equal(environment.includes("NEXT_PUBLIC_"), false);
  assert.match(gitignore, /\.env\.\*/);
  assert.match(gitignore, /\*\.sqlite/);
  assert.match(gitignore, /\*\.tgz/);
  assert.match(dockerignore, /\.env\*/);
  assert.match(dockerignore, /__pycache__/);
  assert.match(dockerignore, /docs\/strategy-artifact\.html/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /AS production-dependencies/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /node_modules\/typescript/);
  assert.match(dockerfile, /node_modules\/@playwright/);
  assert.match(dockerfile, /--from=production-dependencies \/app\/node_modules/);
  assert.match(compose, /cutout-data:\/var\/lib\/cutout(?:\r?\n|$)/);
  assert.doesNotMatch(compose, /cutout-data:\/var\/lib\/cutout:ro/);
  assert.match(read("apps/web/lib/server-runtime.ts"), /readOnly: true/);
  assert.match(read("src/indexer/store.ts"), /PRAGMA query_only = ON/);
  assert.equal((compose.match(/cap_drop:/g) ?? []).length, 2);
  assert.equal((compose.match(/no-new-privileges:true/g) ?? []).length, 2);
  assert.match(ci, /fetch-depth: 2/);
});
