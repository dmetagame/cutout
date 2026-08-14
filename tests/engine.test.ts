import assert from "node:assert/strict";
import test from "node:test";

import { CUTOUT_MODEL, evaluatePreflight } from "../src/index.js";
import type {
  Address,
  DepositObservation,
  PreflightResult,
  SupportedPreflightResult,
} from "../src/index.js";

const account = "0xabc" as Address;
const other = "0xdef" as Address;
const token = "0x123" as Address;
const now = 2_000_000_000;

function deposit(
  amount: bigint,
  ageSeconds: number,
  index: number,
  depositor: Address = other,
): DepositObservation {
  return {
    blockNumber: 10_000 + index,
    timestamp: now - ageSeconds,
    transactionHash: `0x${(1000 + index).toString(16)}`,
    depositor,
    token,
    amount,
  };
}

function durable(amount: bigint, count = 8): DepositObservation[] {
  return Array.from({ length: count }, (_, index) =>
    deposit(amount, (index + 1) * 24 * 60 * 60, index, `0x${index + 10}` as Address),
  );
}

function supported(result: PreflightResult): SupportedPreflightResult {
  assert.equal(result.status, "SUPPORTED");
  if (result.status !== "SUPPORTED") throw new Error("expected supported result");
  return result;
}

test("model constants remain frozen at CUTOUT-v1.3", () => {
  assert.deepEqual(CUTOUT_MODEL, {
    version: "CUTOUT-v1.3",
    observationSeconds: 2_592_000,
    cohortSeconds: 86_400,
    proximitySeconds: 3_600,
    channelSeconds: 1_800,
    thinCohort: 5,
    minAddresses: 3,
    maxTopShare: 0.5,
    maxBurstShare: 0.6,
    minActiveDays: 7,
    amountTolerance: 0n,
  });
});

test("fails closed for action types without causal scoring rules", () => {
  const result = evaluatePreflight({
    intent: {
      action: "withdraw",
      account,
      token,
      amount: { mode: "exact", value: 5_000n },
      deadline: now + 3_600,
    },
    now,
    deposits: [],
    registrations: [],
  });

  assert.equal(result.status, "UNSUPPORTED_ACTION");
});

test("warns on a unique exact shield with no intent-preserving alternative", () => {
  const result = supported(evaluatePreflight({
    intent: {
      action: "shield",
      account,
      token,
      amount: { mode: "exact", value: 4_713_22n },
      deadline: now + 3_600,
    },
    now,
    deposits: [],
    registrations: [],
  }));

  assert.equal(result.band, "MEDIUM");
  assert.equal(result.decision, "WARN");
  assert.equal(result.cohort.existingMatches, 0);
  assert.equal(result.cohort.projectedCohort, 1);
  assert.equal(result.recommendation?.kind, "NO_SAFER_EXECUTION");
});

test("recommends the smallest authorised deviation with healthy current cover", () => {
  const target = 4_713n;
  const close = 4_700n;
  const far = 4_600n;
  const deposits = [
    ...durable(close),
    ...durable(far).map((row, index) => ({ ...row, blockNumber: row.blockNumber + 100, transactionHash: `0x${2000 + index}` as `0x${string}` })),
    deposit(close, 300, 50, "0x50" as Address),
    deposit(close, 600, 51, "0x51" as Address),
    deposit(close, 900, 52, "0x52" as Address),
    deposit(close, 1_200, 53, "0x53" as Address),
    deposit(close, 1_500, 54, "0x54" as Address),
    deposit(far, 300, 60, "0x60" as Address),
    deposit(far, 600, 61, "0x61" as Address),
    deposit(far, 900, 62, "0x62" as Address),
    deposit(far, 1_200, 63, "0x63" as Address),
    deposit(far, 1_500, 64, "0x64" as Address),
  ];

  const result = supported(evaluatePreflight({
    intent: {
      action: "shield",
      account,
      token,
      amount: { mode: "flexible", target, min: 4_500n, max: 4_800n },
      deadline: now + 3_600,
    },
    now,
    deposits,
    registrations: [],
  }));

  assert.equal(result.recommendation?.kind, "CHANGE_AMOUNT");
  if (result.recommendation?.kind === "CHANGE_AMOUNT") {
    assert.equal(result.recommendation.to, close);
    assert.equal(result.recommendation.absoluteDeviation, 13n);
    assert.equal(result.recommendation.cohort.healthy, true);
  }
});

test("flags channel setup immediately before shielding", () => {
  const amount = 4n;
  const deposits = [
    ...durable(amount),
    deposit(amount, 300, 80, "0x80" as Address),
    deposit(amount, 600, 81, "0x81" as Address),
    deposit(amount, 900, 82, "0x82" as Address),
    deposit(amount, 1_200, 83, "0x83" as Address),
    deposit(amount, 1_500, 84, "0x84" as Address),
  ];
  const result = supported(evaluatePreflight({
    intent: {
      action: "shield",
      account,
      token,
      amount: { mode: "exact", value: amount },
      deadline: now + 3_600,
    },
    now,
    deposits,
    registrations: [
      {
        blockNumber: 99,
        timestamp: now - 60,
        transactionHash: "0x999",
        account,
      },
    ],
  }));

  assert.equal(result.signals.find((signal) => signal.id === "S4")?.status, "FIRED");
  assert.equal(result.band, "LOW");
});

test("does not count future deposits in the live cohort", () => {
  const amount = 10n;
  const result = supported(evaluatePreflight({
    intent: {
      action: "shield",
      account,
      token,
      amount: { mode: "exact", value: amount },
      deadline: now + 3_600,
    },
    now,
    deposits: [
      deposit(amount, 300, 90, "0x90" as Address),
      { ...deposit(amount, 0, 91, "0x91" as Address), timestamp: now + 300 },
    ],
    registrations: [],
  }));

  assert.equal(result.cohort.existingMatches, 1);
  assert.equal(result.cohort.projectedCohort, 2);
});

test("rejects a large but short-lived campaign cohort", () => {
  const amount = 51n;
  const deposits = Array.from({ length: 20 }, (_, index) =>
    deposit(amount, 300 + index * 60, 100 + index, `0x${300 + index}` as Address),
  );
  const result = supported(evaluatePreflight({
    intent: {
      action: "shield",
      account,
      token,
      amount: { mode: "exact", value: amount },
      deadline: now + 3_600,
    },
    now,
    deposits,
    registrations: [],
  }));

  assert.equal(result.cohort.projectedCohort, 21);
  assert.equal(result.cohort.healthy, false);
  assert.ok(result.cohort.failures.includes("INSUFFICIENT_ACTIVE_DAYS"));
  assert.ok(result.cohort.failures.includes("BURST_CONCENTRATION"));
});
