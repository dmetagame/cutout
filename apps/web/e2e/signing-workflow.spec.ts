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
  await expect(page.getByRole("heading", { name: "Check an exact amount against current public STRK20 traffic, then stop at Ready X." })).toBeVisible();
  await expect(page.locator(".cover-ledger-label")).toHaveText("Current public cover · trailing 24h");
  await expect(page.locator(".corner-meta")).toHaveCount(4);
  await expect(page.locator(".corner-meta-top-left")).toHaveText("CUTOUT");
  await expect(page.locator(".corner-meta-top-right")).toHaveText("Fixture");
  await expect(page.locator("[data-cover-cell]")).toHaveCount(2);
  await expect(page.locator("[data-cover-cell]").first()).toHaveAttribute("data-motion-revealed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "enhanced");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(true);
  await expect(page.locator(".flow-rail-shell")).toHaveCount(0);
  await expect(page.locator(".evidence-surface")).toHaveCount(0);
}

async function connectWallet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText("Wallet connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Cutout E2E Wallet", { exact: true })).toBeVisible();
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

  await expect(page.getByText("Connection is not authorization.", { exact: true })).toBeVisible();
  await expect(page.locator(".segmented-control button").filter({ hasText: "Withdraw" })).toContainText("analysis only");
  await expect(page.locator(".evidence-surface")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check deposit" })).toBeDisabled();
  const coverRow = page.getByRole("button", { name: "Select 4700 USDC", exact: true });
  await expect(coverRow).toBeVisible();
  await coverRow.hover();
  await expect.poll(() => page.locator("[data-cover-cell]").nth(1).evaluate((element) => Number(getComputedStyle(element).opacity))).toBeLessThan(0.6);
  await coverRow.click();
  await expect(page.getByLabel("Target amount")).toHaveValue("4700");
  await expect(coverRow).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".amount-transfer")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect wallet" })).toBeFocused();

  const harness = await walletHarnessState(page);
  expect(harness.connectCalls).toBe(0);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("a connected cover row fills the exact amount and runs one preflight", async ({ page }) => {
  await installWalletHarness(page);
  await page.goto("/");
  await connectWallet(page);

  const preflightRequest = page.waitForRequest((request) =>
    request.url().includes("/api/preflight") && request.method() === "POST",
  );
  const coverRow = page.getByRole("button", { name: "Use and check 4700 USDC", exact: true });
  await coverRow.click();
  const request = await preflightRequest;
  expect(request.postDataJSON()).toMatchObject({ action: "shield", amount: "4700000000" });
  await expect(page.getByLabel("Target amount")).toHaveValue("4700");
  await expect(coverRow).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".decision-hero")).toBeVisible();
  await expect(page.locator("[data-decision-plate]")).toHaveAttribute("data-motion-plate", "true");

  const harness = await walletHarnessState(page);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("Enter checks only the proposal and Escape closes its disclosure", async ({ page }) => {
  await installWalletHarness(page);
  await page.goto("/");
  await connectWallet(page);
  await page.getByLabel("Target amount").fill("4700");
  await page.getByLabel("Target amount").press("Enter");

  await expect(page.locator(".decision-hero")).toBeVisible();
  const disclosure = page.locator(".evidence-disclosure").first();
  await expect(disclosure).toHaveAttribute("open", "");
  const summary = disclosure.locator("summary");
  await summary.focus();
  await page.keyboard.press("Escape");
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(summary).toBeFocused();

  const harness = await walletHarnessState(page);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("390px cover cells stack without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installWalletHarness(page);
  await page.goto("/");
  const cells = page.locator("[data-cover-cell]");
  await cells.first().scrollIntoViewIfNeeded();
  await expect(cells).toHaveCount(2);

  const layout = await page.evaluate(() => {
    const coverCells = Array.from(document.querySelectorAll<HTMLElement>("[data-cover-cell]"));
    const first = coverCells[0];
    const second = coverCells[1];
    const cellMeta = first?.querySelector<HTMLElement>(".cover-cell-stats");
    const connect = document.querySelector<HTMLElement>("#connect-wallet");
    const check = document.querySelector<HTMLElement>(".form-actions button[type='submit']");
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      stacked: first !== undefined && second !== undefined
        ? second.getBoundingClientRect().top >= first.getBoundingClientRect().bottom
        : false,
      cellFontSize: cellMeta === null || cellMeta === undefined
        ? 0
        : Number.parseFloat(getComputedStyle(cellMeta).fontSize),
      cellRight: first?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY,
      connectHeight: connect?.getBoundingClientRect().height ?? 0,
      checkHeight: check?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.stacked).toBe(true);
  expect(layout.cellFontSize).toBeGreaterThanOrEqual(11);
  expect(layout.cellRight).toBeLessThanOrEqual(390);
  expect(layout.connectHeight).toBeGreaterThanOrEqual(44);
  expect(layout.checkHeight).toBeGreaterThanOrEqual(44);
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
  await page.clock.setFixedTime(await page.evaluate(() => Date.now()));

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
    await expect(page.locator(".flow-rail-shell")).toHaveCount(0);
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
    hiddenMotionItems: Array.from(document.querySelectorAll<HTMLElement>("[data-motion-intro], [data-motion-section]"))
      .filter((element) => getComputedStyle(element).visibility === "hidden" || getComputedStyle(element).opacity === "0")
      .length,
    transformedCoverCells: Array.from(document.querySelectorAll<HTMLElement>("[data-cover-cell-face]"))
      .filter((element) => getComputedStyle(element).transform !== "none")
      .length,
    transformedPlate: getComputedStyle(document.querySelector<HTMLElement>("[data-decision-plate]")!).transform,
  }));
  expect(motionState.hiddenMotionItems).toBe(0);
  expect(motionState.transformedCoverCells).toBe(0);
  expect(motionState.transformedPlate).toBe("none");
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
  await expect(page.getByRole("heading", { name: "Check an exact amount against current public STRK20 traffic, then stop at Ready X." })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "enhanced");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(true);
  await expect(page.locator(".flow-rail-shell")).toHaveCount(0);
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

test("snapshot advance clears the discarded result before a fresh preflight", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/preflight", async (route) => {
    attempts += 1;
    if (attempts !== 1) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        status: "NO_CONFIDENT_RECOMMENDATION",
        modelVersion: "CUTOUT-v1.4",
        guardPolicyVersion: "GUARD_POLICY-v1",
        error: {
          code: "INDEX_CORRUPT",
          message: "Intent evaluation block does not match the snapshot.",
        },
        snapshotHash: null,
        decisionId: `0x${"11".repeat(32)}`,
        nonClaims: ["Candidate cohorts are public evidence only."],
      }),
    });
  });
  await installWalletHarness(page);
  await page.goto("/");

  await connectWallet(page);
  await page.getByLabel("Target amount").fill("4700");
  await page.getByRole("button", { name: "Check deposit" }).click();

  const unavailableAlert = page.locator(".alert-wide[role='alert']");
  await expect(unavailableAlert).toContainText("Snapshot changed during check");
  await expect(page.getByRole("button", { name: "Confirm in wallet" })).toHaveCount(0);
  await unavailableAlert.getByRole("button", { name: "Check snapshot" }).click();
  await expect(page.getByRole("button", { name: "Check deposit" })).toBeEnabled();
  await page.getByRole("button", { name: "Check deposit" }).click();
  await expect(page.getByRole("heading", { name: "Evidence and decision" })).toBeVisible();
  await expect.poll(() => attempts).toBe(2);

  const harness = await walletHarnessState(page);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("wrong-network wallet fails closed before preflight or simulation", async ({ page }) => {
  await installWalletHarness(page, { chainId: "0x534e5f5345504f4c4941" });
  await page.goto("/");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText("WALLET_NETWORK_MISMATCH", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check deposit" })).toBeDisabled();

  const harness = await walletHarnessState(page);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("unsupported Wallet API fails closed", async ({ page }) => {
  await installWalletHarness(page, { apiVersions: ["0.7.2"] });
  await page.goto("/");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "UNSUPPORTED_WALLET_API" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check deposit" })).toBeDisabled();

  const harness = await walletHarnessState(page);
  expect(harness.connectCalls).toBe(0);
  expect(harness.prepareCalls).toBe(0);
  expect(harness.invokeCalls).toBe(0);
});

test("simulation failure never exposes the confirmation call", async ({ page }) => {
  await page.clock.setFixedTime(new Date(2_000_000_000_000));
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
  await page.clock.setFixedTime(await page.evaluate(() => Date.now()));

  await page.locator(".segmented-control button").filter({ hasText: "Withdraw" }).click();
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
