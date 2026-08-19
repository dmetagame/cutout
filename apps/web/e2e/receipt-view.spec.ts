import { expect, test } from "@playwright/test";

const RECEIPT_ID =
  "0x09adfe7664898666360052a35a9e3551e1c343c14fff37ea6d6fafb9046d643c";
const RECEIPT_ARTIFACT = {
  schemaVersion: "CUTOUT_RECEIPT-v1",
  transactionHash:
    "0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e",
  chainId: "0x534e5f4d41494e",
  pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  token: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  amount: "10000000000000000",
  account: "0x05854e275d709627eb88a95519326c528f8c5dc402d350d29e72dbcaf48b434f",
  blockNumber: 13_427_531,
  blockHash: "0x7c07bd1afcbf10a69bcb9ff23643a98469c9f7a76183962bdc5c8389da67e94",
  observedSnapshotHash:
    "0xbe131fcf5f63309e40b8e3656465e56bac7f5b8a1b8d5336974071bfabc34acf",
  engineVersion: "CUTOUT-v1.3",
  guardPolicyVersion: "GUARD_POLICY-v1",
  decision: "ALLOW",
  selectedAmount: "10000000000000000",
  recommendationStatus: "ORIGINAL",
  timestamp: 1_786_955_795,
  receiptId: RECEIPT_ID,
} as const;

async function installReceiptArtifact(
  page: import("@playwright/test").Page,
  artifact: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript(({ key, value }) => {
    sessionStorage.setItem(key, JSON.stringify(value));
  }, {
    key: `cutout-receipt:${RECEIPT_ID}`,
    value: artifact,
  });
}

test("verified receipt evidence remains usable across responsive viewports", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installReceiptArtifact(page, RECEIPT_ARTIFACT);
  await page.goto(`/receipt/${RECEIPT_ID}`);

  await expect(page.getByRole("heading", { name: "Deposit verified on Starknet." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open explorer" })).toHaveAttribute(
    "href",
    `https://starkscan.co/tx/${RECEIPT_ARTIFACT.transactionHash}`,
  );
  await expect(page.getByText(RECEIPT_ID, { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  expect(await page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(false);

  const disclosure = page.locator("summary");
  await page.keyboard.press("Tab");
  await expect(disclosure).toBeFocused();
  expect(await disclosure.evaluate((element) => getComputedStyle(element).outlineWidth)).not.toBe("0px");

  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 430, height: 932 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.getByRole("link", { name: "Open explorer" })).toBeVisible();
  }
});

test("receipt data with a stale ID binding cannot display a verified claim", async ({ page }) => {
  await installReceiptArtifact(page, {
    ...RECEIPT_ARTIFACT,
    amount: "20000000000000000",
  });
  await page.goto(`/receipt/${RECEIPT_ID}`);

  await expect(page.getByRole("heading", { name: "Receipt artifact unavailable." })).toBeVisible();
  await expect(page.getByText("No success claim is shown", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deposit verified on Starknet." })).toHaveCount(0);
});
