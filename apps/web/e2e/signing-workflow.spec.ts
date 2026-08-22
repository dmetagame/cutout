import { expect, test, type Page } from "@playwright/test";

import {
  installWalletHarness,
  MAINNET_CHAIN_ID,
  walletHarnessState,
} from "./wallet-harness";

const TARGET_AMOUNT = "4713.22";
const MINIMUM_AMOUNT = "4600";
const MAXIMUM_AMOUNT = "4800";

async function expectCurrentEntry(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Cutout decides. Your wallet signs." })).toBeVisible();
  await expect(page.getByText("Current public snapshot", { exact: true })).toBeVisible();
  await expect(page.getByText("Public cover ledger", { exact: true })).toBeVisible();
  await expect(page.locator(".cover-ledger-foot")).toContainText("Model CUTOUT-v1.4");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "enhanced");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(true);
  await expect(page.locator(".flow-step")).toHaveCount(5);
  await expect(page.locator(".flow-step[aria-current='step']")).toHaveCount(1);
}

async function connectWallet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText("Wallet connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Cutout E2E Wallet | API 0.10.3", { exact: true })).toBeVisible();
}

async function prepareFlexibleDeposit(page: Page): Promise<void> {
  await connectWallet(page);
  await page.getByLabel("Target amount").fill(TARGET_AMOUNT);
  await page.locator(".workflow-surface input[type='checkbox']").check();
  await page.getByLabel("Minimum amount").fill(MINIMUM_AMOUNT);
  await page.getByLabel("Maximum amount").fill(MAXIMUM_AMOUNT);
  await page.getByRole("button", { name: "Check deposit" }).click();
}

async function chooseDepositRecommendation(page: Page): Promise<void> {
  await expect(page.getByText("HIGH", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("DENY", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Healthier permitted amount" })).toBeVisible();
  await expect(page.locator(".recommendation-comparison").getByText("4700 USDC", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use recommendation" }).click();
}

test("the entry surface exposes current cover evidence without wallet authority", async ({ page }) => {
  await installWalletHarness(page);
  await page.goto("/");
  await expectCurrentEntry(page);

  await expect(page.getByText("Choose an amount", { exact: true })).toBeVisible();
  await expect(page.getByText("Connection is not authorization.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check deposit" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "4700 USDC", exact: true })).toBeVisible();

  const harness = await walletHarnessState(page);
  expect(harness.connectCalls).toBe(0);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("a recommended deposit reaches ready-for-confirmation without broadcasting", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.url()} :: ${request.failure()?.errorText ?? "failed"}`);
  });
  await installWalletHarness(page);
  await page.goto("/");
  await expectCurrentEntry(page);

  await prepareFlexibleDeposit(page);
  await chooseDepositRecommendation(page);

  const finalReview = page.getByRole("region", { name: "Final review" });
  await expect(finalReview).toBeVisible();
  await expect(finalReview.getByText("ALLOW | LOW", { exact: true })).toBeVisible();
  await expect(finalReview.getByText("4700 USDC", { exact: true })).toBeVisible();
  await expect(finalReview.getByText("Cutout does not sign or broadcast this transaction.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Simulate in wallet" }).click();
  await expect(page.getByText("Simulation passed", { exact: true })).toBeVisible();
  await expect(page.getByText("No submission", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready for your confirmation", { exact: true })).toBeVisible();
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
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
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

  await prepareFlexibleDeposit(page);
  await expect(page.getByRole("heading", { name: "Healthier permitted amount" })).toBeVisible();
  await page.waitForTimeout(6_000);
  await page.getByRole("button", { name: "Use recommendation" }).click();
  await expect.poll(() => intents.length).toBe(2);
  const [initialIntent, finalIntent] = intents;
  if (initialIntent === undefined || finalIntent === undefined) {
    throw new Error("Expected initial and final preflight intents.");
  }
  expect(finalIntent.evaluationTimestamp).toBeGreaterThan(initialIntent.evaluationTimestamp);
});

test("the final review remains stable across desktop, tablet, and mobile widths", async ({ page }) => {
  await installWalletHarness(page);
  await page.goto("/");
  await prepareFlexibleDeposit(page);
  await chooseDepositRecommendation(page);
  const finalReview = page.getByRole("region", { name: "Final review" });
  await expect(finalReview).toBeVisible();

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 900 },
    { width: 768, height: 1024 },
    { width: 430, height: 932 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    const rail = await page.locator(".flow-rail-shell").boundingBox();
    expect(rail?.width ?? 0).toBeLessThanOrEqual(viewport.width);
    await expect(page.locator(".flow-step")).toHaveCount(5);
    await expect(finalReview).toBeVisible();
    await expect(page.getByRole("button", { name: "Simulate in wallet" })).toBeVisible();
  }
});

test("reduced motion preserves keyboard access and all signing information", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installWalletHarness(page);
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  expect(await page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(false);
  const connectButton = page.getByRole("button", { name: "Connect wallet" });
  await connectButton.focus();
  await expect(connectButton).toBeFocused();
  expect(await connectButton.evaluate((element) => getComputedStyle(element).outlineWidth)).not.toBe("0px");

  await page.keyboard.press("Enter");
  await expect(page.getByText("Wallet connected", { exact: true })).toBeVisible();
  await page.getByLabel("Target amount").fill("4700");
  await page.getByRole("button", { name: "Check deposit" }).click();
  await expect(page.getByRole("heading", { name: "Evidence and decision" })).toBeVisible();

  const motionState = await page.evaluate(() => ({
    railTransform: getComputedStyle(document.querySelector(".flow-rail") as Element).transform,
    hiddenMotionItems: Array.from(document.querySelectorAll<HTMLElement>("[data-motion-intro], [data-motion-section]"))
      .filter((element) => getComputedStyle(element).visibility === "hidden" || getComputedStyle(element).opacity === "0")
      .length,
  }));
  expect(motionState.railTransform).toBe("none");
  expect(motionState.hiddenMotionItems).toBe(0);
  const harness = await walletHarnessState(page);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("motion preference changes cleanly switch the scrolling and reveal systems", async ({ page }) => {
  await installWalletHarness(page);
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-motion", "enhanced");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(false);
  await expect(page.getByRole("heading", { name: "Cutout decides. Your wallet signs." })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "enhanced");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(true);
  await expect(page.locator(".flow-step[aria-current='step']")).toHaveCount(1);
});

test("preflight transport failure remains unavailable and never exposes a decision", async ({ page }) => {
  await installWalletHarness(page);
  await page.route("**/api/preflight", (route) => route.abort("failed"));
  await page.goto("/");

  await connectWallet(page);
  await page.getByLabel("Target amount").fill("4700");
  await page.getByRole("button", { name: "Check deposit" }).click();

  const unavailableAlert = page.locator(".alert-wide[role='alert']");
  await expect(unavailableAlert).toContainText("BACKEND_UNAVAILABLE");
  await expect(unavailableAlert).toContainText("Cutout cannot safely make this decision from the current public state.");
  const decisionPanel = page.locator(".evidence-surface");
  await expect(decisionPanel.locator(".decision-hero")).toHaveCount(0);
  await expect(decisionPanel.getByText("LOW", { exact: true })).toHaveCount(0);
  await expect(decisionPanel.getByText("MEDIUM", { exact: true })).toHaveCount(0);
  await expect(decisionPanel.getByText("HIGH", { exact: true })).toHaveCount(0);
  const harness = await walletHarnessState(page);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("wrong-network wallet fails closed before preflight or simulation", async ({ page }) => {
  await installWalletHarness(page, { chainId: "0x534e5f5345504f4c4941" });
  await page.goto("/");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText("WALLET_NETWORK_MISMATCH", { exact: true })).toBeVisible();
  await expect(page.locator(".form-actions .button-primary")).toBeDisabled();

  const harness = await walletHarnessState(page);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("unsupported Wallet API fails closed", async ({ page }) => {
  await installWalletHarness(page, { apiVersions: ["0.7.2"] });
  await page.goto("/");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "UNSUPPORTED_WALLET_API" })).toBeVisible();
  await expect(page.locator(".form-actions .button-primary")).toBeDisabled();

  const harness = await walletHarnessState(page);
  expect(harness.connectCalls).toBe(0);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("simulation failure never exposes the confirmation call", async ({ page }) => {
  await installWalletHarness(page, { simulationFailure: "Protocol simulation rejected." });
  await page.goto("/");
  await prepareFlexibleDeposit(page);
  await chooseDepositRecommendation(page);
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

  await connectWallet(page);
  await page.getByLabel("Target amount").fill("1e3");
  await page.getByRole("button", { name: "Check deposit" }).click();

  await expect(page.locator(".workflow-surface [role='alert']")).toContainText("INVALID_AMOUNT");
  const harness = await walletHarnessState(page);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("withdrawal analysis stops before wallet simulation or submission", async ({ page }) => {
  await installWalletHarness(page);
  await page.goto("/");

  await page.locator(".action-selector button").filter({ hasText: "Withdraw" }).click();
  await connectWallet(page);
  await page.getByLabel("Target amount").fill("4700");
  await page.locator(".workflow-surface input[type='checkbox']").check();
  await page.getByLabel("Minimum amount").fill(MINIMUM_AMOUNT);
  await page.getByLabel("Maximum amount").fill(MAXIMUM_AMOUNT);
  await page.getByRole("button", { name: "Analyze withdrawal" }).click();

  await expect(page.getByRole("heading", { name: "Lower-linkage permitted amount" })).toBeVisible();
  await expect(page.locator(".recommendation-comparison").getByText("4650 USDC", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use recommendation" }).click();
  const withdrawalResult = page.getByRole("region", { name: "Withdrawal analysis complete" });
  await expect(withdrawalResult).toBeVisible();
  await expect(withdrawalResult.getByText("ANALYSIS ONLY", { exact: true })).toBeVisible();
  await expect(page.getByText("No wallet simulation or transaction has been requested.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Simulate in wallet" })).toHaveCount(0);

  const harness = await walletHarnessState(page);
  expect(harness.connectCalls).toBe(1);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});
