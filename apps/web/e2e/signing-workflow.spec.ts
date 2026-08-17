import { expect, test } from "@playwright/test";

import {
  installWalletHarness,
  MAINNET_CHAIN_ID,
  walletHarnessState,
} from "./wallet-harness";

test("a recommended deposit reaches wallet confirmation without broadcasting", async ({ page }) => {
  await installWalletHarness(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Protect your STRK20 deposit before you sign." })).toBeVisible();
  await expect(page.getByText("0xb32956e5...95861e50")).toBeVisible();

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText("Wallet connected")).toBeVisible();
  await expect(page.getByText("Cutout E2E Wallet | API 0.10.3")).toBeVisible();

  await page.getByRole("button", { name: "Run Cutout check" }).click();
  await expect(page.getByText("MEDIUM", { exact: true })).toBeVisible();
  await expect(page.getByText("WARN", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Safer permitted amount" })).toBeVisible();
  await expect(page.getByText("4700 USDC", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Use recommendation" }).click();
  const finalReview = page.getByRole("region", { name: "Final review" });
  await expect(finalReview).toBeVisible();
  await expect(finalReview.getByText("ALLOW | LOW", { exact: true })).toBeVisible();
  await expect(finalReview.getByText("4700 USDC", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Simulate in wallet" }).click();
  await expect(page.getByRole("heading", { name: "Wallet confirmation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm in wallet" })).toBeEnabled();

  const harness = await walletHarnessState(page);
  expect(harness.connectCalls).toBe(1);
  expect(harness.prepareCalls).toBe(1);
  expect(harness.invokeCalls).toBe(0);
  expect(harness.requests.map((request) => request.type)).toEqual([
    "wallet_supportedWalletApi",
    "wallet_requestChainId",
    "wallet_strk20PrepareInvoke",
  ]);
  expect(harness.requests.at(-1)?.params).toMatchObject({
    simulate: true,
    actions: [{ type: "deposit" }],
  });
  await expect(page.getByText("Transaction submitted", { exact: true })).toHaveCount(0);
});

test("refreshes the final intent timestamp after a delayed amount choice", async ({ page }) => {
  await installWalletHarness(page);
  await page.goto("/");

  const intents: Array<{ readonly evaluationTimestamp: number }> = [];
  page.on("request", (request) => {
    if (!request.url().includes("/api/preflight") || request.method() !== "POST") return;
    const body = request.postDataJSON() as { readonly evaluationTimestamp?: unknown };
    if (typeof body.evaluationTimestamp === "number") {
      intents.push({ evaluationTimestamp: body.evaluationTimestamp });
    }
  });

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Run Cutout check" }).click();
  await expect(page.getByRole("heading", { name: "Safer permitted amount" })).toBeVisible();
  await page.waitForTimeout(6_000);
  await page.getByRole("button", { name: "Use recommendation" }).click();
  await expect.poll(() => intents.length).toBe(2);
  const [initialIntent, finalIntent] = intents;
  if (initialIntent === undefined || finalIntent === undefined) {
    throw new Error("Expected initial and final preflight intents.");
  }
  expect(finalIntent.evaluationTimestamp).toBeGreaterThan(initialIntent.evaluationTimestamp);
});

test("the signing decision remains usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installWalletHarness(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Run Cutout check" }).click();
  await expect(page.getByRole("heading", { name: "Safer permitted amount" })).toBeVisible();
  await page.getByRole("button", { name: "Use recommendation" }).click();
  await expect(page.getByRole("region", { name: "Final review" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("wrong-network wallet fails closed before preflight or simulation", async ({ page }) => {
  await installWalletHarness(page, { chainId: "0x534e5f5345504f4c4941" });
  await page.goto("/");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText("WALLET_NETWORK_MISMATCH", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Cutout check" })).toBeDisabled();

  const harness = await walletHarnessState(page);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("unsupported Wallet API fails closed", async ({ page }) => {
  await installWalletHarness(page, { apiVersions: ["0.7.2"] });
  await page.goto("/");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "UNSUPPORTED_WALLET_API" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Cutout check" })).toBeDisabled();

  const harness = await walletHarnessState(page);
  expect(harness.connectCalls).toBe(0);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("simulation failure never exposes the confirmation call", async ({ page }) => {
  await installWalletHarness(page, { simulationFailure: "Protocol simulation rejected." });
  await page.goto("/");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Run Cutout check" }).click();
  await page.getByRole("button", { name: "Use recommendation" }).click();
  await page.getByRole("button", { name: "Simulate in wallet" }).click();

  await expect(page.getByText("WALLET_SIMULATION_FAILED", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm in wallet" })).toHaveCount(0);
  const harness = await walletHarnessState(page);
  expect(harness.prepareCalls).toBe(1);
  expect(harness.invokeCalls).toBe(0);
});

test("malformed amount produces no preflight and no wallet action", async ({ page }) => {
  await installWalletHarness(page, { chainId: MAINNET_CHAIN_ID });
  await page.goto("/");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByLabel("Target amount").fill("1e3");
  await page.getByRole("button", { name: "Run Cutout check" }).click();

  await expect(page.getByRole("region", { name: "Proposed shield" }).getByRole("alert")).toContainText("INVALID_AMOUNT");
  const harness = await walletHarnessState(page);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});
