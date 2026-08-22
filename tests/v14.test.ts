import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  CUTOUT_MODEL,
  CUTOUT_MODEL_V1_4,
  DataLayerError,
  FRESHNESS_POLICY,
  GUARD_POLICY,
  IndexerSupervisor,
  PreflightService,
  CanonicalStore,
  decodePoolEvent,
  evaluatePreflight,
  evaluatePreflightV14,
  loadPoolAbiFixture,
  mainnetConfig,
  requestPreflight,
  reviewPoolAbi,
  validateSingleDepositAction,
} from "../src/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeAddress } from "../src/starknet/felt.js";
import type {
  Address,
  DepositObservation,
  PublicWithdrawalObservation,
  RpcBlockHeader,
  RpcEvent,
  WireWithdrawIntent,
  WithdrawIntent,
} from "../src/index.js";
import { loadReplayFixture, ReplayRpc } from "./helpers/replay-rpc.js";

const fixture = await loadPoolAbiFixture();
const abi = reviewPoolAbi(fixture);
const pool = abi.poolAddress as Address;
const token = "0x123" as Address;
const account = "0xabc" as Address;
const recipient = "0xdef" as Address;
const now = 2_000_000_000;
const replay = await loadReplayFixture();
const config = mainnetConfig({
  CHAIN_ID: replay.chainId,
  POOL_ADDRESS: replay.poolAddress,
  RPC_URL: "https://fixture.invalid",
  CUTOUT_RPC_RANGE_BLOCKS: "3",
});

function temporaryDatabase(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "cutout-v14-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "cutout.sqlite");
}

function fixtureBlockTimestamp(blockNumber: number): number {
  const block = replay.branches.canonical.blocks.find((candidate) => candidate.blockNumber === blockNumber);
  if (block === undefined) throw new Error(`Missing replay block ${blockNumber}.`);
  return block.timestamp;
}

function wireWithdraw(snapshot: { readonly observedBlock: number }, timestamp: number): WireWithdrawIntent {
  return {
    action: "withdraw",
    chainId: config.chainId,
    account: replay.account,
    recipient: replay.account,
    token: replay.token,
    amount: "100",
    evaluationBlock: snapshot.observedBlock,
    evaluationTimestamp: timestamp,
    flexibility: { mode: "exact" },
    deadline: timestamp + 3_600,
  };
}

function deposit(amount: bigint, timestamp: number, index: number): DepositObservation {
  return {
    blockNumber: 10_000 + index,
    timestamp,
    transactionHash: `0x${(1_000 + index).toString(16)}`,
    depositor: `0x${(100 + index).toString(16)}` as Address,
    token,
    amount,
  };
}

function withdrawal(
  amount: bigint,
  timestamp: number,
  index: number,
): PublicWithdrawalObservation {
  const normalizedRecipient = `0x${(200 + index).toString(16)}` as Address;
  return {
    blockNumber: 20_000 + index,
    blockHash: `0x${(30_000 + index).toString(16)}`,
    timestamp,
    transactionHash: `0x${(2_000 + index).toString(16)}`,
    eventIndex: 0,
    eventId: `${20_000 + index}:0x${(2_000 + index).toString(16)}:0`,
    eventSelector: abi.withdrawal.selector,
    recipient: normalizedRecipient,
    token,
    amount,
    normalizedFields: {
      recipient: normalizedRecipient,
      token,
      amount: amount.toString(10),
    },
  };
}

function validWithdrawIntent(amount: bigint): WithdrawIntent {
  return {
    action: "withdraw",
    account,
    recipient,
    token,
    amount: { mode: "exact", value: amount },
    deadline: now + 3_600,
  };
}

test("reviewed ABI includes the live Withdrawal event without retaining its encrypted payload", () => {
  assert.equal(abi.withdrawal.selector, "0x2eed7e29b3502a726faf503ac4316b7101f3da813654e8df02c13449e03da8");
  assert.equal(abi.withdrawal.keyFeltCount, 3);
  assert.equal(abi.withdrawal.dataFeltCount, 4);

  const block: RpcBlockHeader = {
    blockNumber: 42,
    blockHash: "0x42",
    parentHash: "0x41",
    timestamp: now - 60,
    status: "ACCEPTED_ON_L2",
  };
  const raw: RpcEvent = {
    block_hash: block.blockHash,
    block_number: block.blockNumber,
    from_address: pool,
    transaction_hash: "0x4242",
    keys: [abi.withdrawal.selector, recipient, token],
    data: ["0xaaa", "0xbbb", "0xccc", "0x64"],
  };
  const decoded = decodePoolEvent(raw, 0, block, pool, abi);
  assert.equal(decoded.kind, "withdrawal");
  if (decoded.kind !== "withdrawal") return;
  assert.equal(decoded.observation.recipient, normalizeAddress(recipient, "test recipient"));
  assert.equal(decoded.observation.amount, 100n);
  const serialized = JSON.stringify(decoded, (_key, value) =>
    typeof value === "bigint" ? value.toString(10) : value,
  );
  assert.equal(serialized.includes("0xaaa"), false);
  assert.equal(serialized.includes("0xbbb"), false);
  assert.equal(serialized.includes("0xccc"), false);
});

test("CUTOUT-v1.3 remains an exact replay path and still rejects withdraw", () => {
  const result = evaluatePreflight({
    intent: validWithdrawIntent(100n),
    now,
    deposits: [],
    registrations: [],
  });
  assert.equal(result.status, "UNSUPPORTED_ACTION");
  assert.equal(result.modelVersion, CUTOUT_MODEL.version);
});

test("the v1.3 preflight service fails closed for a typed withdraw intent", async (t) => {
  const clock = fixtureBlockTimestamp(8_978_978) + 1;
  const store = new CanonicalStore({
    path: temporaryDatabase(t),
    config,
    abi,
    now: () => clock,
    modelVersion: CUTOUT_MODEL.version,
  });
  t.after(() => store.close());
  const rpc = new ReplayRpc(replay, 8_978_978);
  const indexed = await new IndexerSupervisor({
    config,
    abi,
    store,
    intervalSeconds: 15,
    modelVersion: CUTOUT_MODEL.version,
    now: () => clock,
    selectRpc: async () => ({ provider: "primary", rpc, degraded: false, providerStates: [] }),
  }).runAttempt();
  const response = new PreflightService(store, config, abi, {
    now: () => clock,
    modelVersion: CUTOUT_MODEL.version,
  }).preflight(wireWithdraw(indexed.snapshot, clock));
  assert.equal(response.status, "NO_CONFIDENT_RECOMMENDATION");
  if (response.status === "NO_CONFIDENT_RECOMMENDATION") {
    assert.equal(response.error.code, "UNSUPPORTED_ACTION");
    assert.equal(response.modelVersion, CUTOUT_MODEL.version);
    assert.equal("decision" in response, false);
  }
});

test("CUTOUT-v1.3 fixed deposit replay remains bit-for-bit stable", () => {
  const result = evaluatePreflight({
    intent: {
      action: "shield",
      account,
      token,
      amount: { mode: "exact", value: 100n },
      deadline: now + 3_600,
    },
    now,
    deposits: [],
    registrations: [],
  });
  assert.deepEqual(result, {
    status: "SUPPORTED",
    modelVersion: CUTOUT_MODEL.version,
    evaluatedAt: now,
    amount: 100n,
    band: "MEDIUM",
    decision: "WARN",
    signals: [
      {
        id: "S1",
        status: "FIRED",
        summary: "The projected deposit amount would occur once in the 30-day observation window.",
      },
      {
        id: "S2",
        status: "NOT_APPLICABLE",
        summary: "A prior withdrawal cannot be funded by a future deposit.",
      },
      {
        id: "S3",
        status: "NOT_APPLICABLE",
        summary: "Deposit-to-withdrawal proximity is not causal for shield preflight.",
      },
      {
        id: "S4",
        status: "CLEAR",
        summary: "No viewing-key registration was observed for this account in the preceding 30 minutes.",
      },
      {
        id: "S5",
        status: "FIRED",
        summary: "Projected cohort fails: THIN_COHORT, LOW_ADDRESS_DIVERSITY, TOP_ADDRESS_CONCENTRATION, INSUFFICIENT_ACTIVE_DAYS, BURST_CONCENTRATION.",
      },
    ],
    cohort: {
      existingMatches: 0,
      projectedCohort: 1,
      trafficEvents: 0,
      distinctAddresses: 1,
      distinctTransactions: 1,
      topAddressShare: 1,
      activeDays: 1,
      maxBurstShare: 1,
      healthy: false,
      failures: [
        "THIN_COHORT",
        "LOW_ADDRESS_DIVERSITY",
        "TOP_ADDRESS_CONCENTRATION",
        "INSUFFICIENT_ACTIVE_DAYS",
        "BURST_CONCENTRATION",
      ],
    },
    recommendation: {
      kind: "NO_SAFER_EXECUTION",
      reason: "The amount is exact and no intent-preserving amount change is permitted.",
    },
  });
});

test("CUTOUT-v1.4 fires S2 and S3 only for a withdraw", () => {
  const result = evaluatePreflightV14({
    intent: validWithdrawIntent(100n),
    now,
    deposits: [deposit(100n, now - 300, 1)],
    withdrawals: [withdrawal(100n, now - 2 * 86_400, 1)],
    registrations: [],
    tokenDecimals: 6,
  });
  assert.equal(result.status, "SUPPORTED");
  if (result.status !== "SUPPORTED") return;
  assert.equal(result.modelVersion, CUTOUT_MODEL_V1_4.version);
  assert.equal(result.signals.find((signal) => signal.id === "S2")?.status, "FIRED");
  assert.equal(result.signals.find((signal) => signal.id === "S3")?.status, "FIRED");
  assert.equal(result.band, "HIGH");
  assert.equal(result.decision, "DENY");
});

test("CUTOUT-v1.4 treats an unused round amount as S7 and returns deterministic WAIT when burst cover may settle", () => {
  const amount = 1_000_000n;
  const withdrawals = Array.from({ length: 10 }, (_, index) =>
    withdrawal(amount, now - 300 - index * 30, index),
  );
  const result = evaluatePreflightV14({
    intent: {
      ...validWithdrawIntent(amount),
      deadline: now + 2 * 86_400,
    },
    now,
    deposits: [],
    withdrawals,
    registrations: [],
    tokenDecimals: 6,
  });
  assert.equal(result.status, "SUPPORTED");
  if (result.status !== "SUPPORTED") return;
  assert.equal(result.signals.find((signal) => signal.id === "S7")?.status, "CLEAR");
  assert.equal(result.signals.find((signal) => signal.id === "S5")?.status, "FIRED");
  assert.equal(result.recommendation?.kind, "WAIT");
  if (result.recommendation?.kind !== "WAIT") return;
  assert.equal(result.recommendation.suggestedHorizonSeconds, 86_400);
});

test("CUTOUT-v1.4 fires S7 for a new 0.01-style amount with no prior exact match", () => {
  const result = evaluatePreflightV14({
    intent: {
      action: "shield",
      account,
      token,
      amount: { mode: "exact", value: 10_000n },
      deadline: now + 3_600,
    },
    now,
    deposits: [],
    withdrawals: [],
    registrations: [],
    tokenDecimals: 6,
  });
  assert.equal(result.status, "SUPPORTED");
  if (result.status !== "SUPPORTED") return;
  assert.equal(result.signals.find((signal) => signal.id === "S7")?.status, "FIRED");
  assert.equal(result.signals.find((signal) => signal.id === "S2")?.status, "NOT_APPLICABLE");
  assert.equal(result.signals.find((signal) => signal.id === "S3")?.status, "NOT_APPLICABLE");
});

test("the v1.4 API transports typed withdraw analysis and reports the configured model while unavailable", async (t) => {
  const clock = fixtureBlockTimestamp(8_978_978) + 1;
  const store = new CanonicalStore({ path: temporaryDatabase(t), config, abi, now: () => clock });
  t.after(() => store.close());
  const rpc = new ReplayRpc(replay, 8_978_978);
  const supervisor = new IndexerSupervisor({
    config,
    abi,
    store,
    intervalSeconds: 15,
    modelVersion: CUTOUT_MODEL_V1_4.version,
    now: () => clock,
    selectRpc: async () => ({ provider: "primary", rpc, degraded: false, providerStates: [] }),
  });
  const indexed = await supervisor.runAttempt();
  assert.equal(indexed.snapshot.engineVersion, CUTOUT_MODEL_V1_4.version);
  assert.equal(indexed.snapshot.withdrawalObservations?.length, 1);

  const service = new PreflightService(store, config, abi, {
    now: () => clock,
    modelVersion: CUTOUT_MODEL_V1_4.version,
  });
  const intent = wireWithdraw(indexed.snapshot, clock);
  const response = service.preflight(intent);
  assert.equal(response.status, "AVAILABLE");
  assert.equal(response.modelVersion, CUTOUT_MODEL_V1_4.version);
  if (response.status === "AVAILABLE") {
    assert.equal(response.signals.find((signal) => signal.id === "S2")?.status, "FIRED");
    assert.equal(response.signals.find((signal) => signal.id === "S3")?.status, "FIRED");
  }

  let transportedBody: unknown;
  const transported = await requestPreflight(async (_url, init) => {
    transportedBody = JSON.parse(init.body);
    return { status: response.status === "AVAILABLE" ? 200 : 503, json: async () => response };
  }, intent);
  assert.deepEqual(transported, response);
  assert.deepEqual(transportedBody, intent);

  store.setStatus("REORGING");
  const unavailable = service.preflight(intent);
  assert.equal(unavailable.status, "NO_CONFIDENT_RECOMMENDATION");
  assert.equal(unavailable.modelVersion, CUTOUT_MODEL_V1_4.version);
  assert.equal(unavailable.guardPolicyVersion, GUARD_POLICY.version);
  assert.equal("decision" in unavailable, false);
});

test("the persisted index identity forces a complete replay across model versions", async (t) => {
  const path = temporaryDatabase(t);
  const rpc = new ReplayRpc(replay, 8_978_978);
  const clock = fixtureBlockTimestamp(rpc.headBlock) + 1;
  const selectRpc = async () => ({
    provider: "primary" as const,
    rpc,
    degraded: false,
    providerStates: [],
  });
  const v13Store = new CanonicalStore({
    path,
    config,
    abi,
    now: () => clock,
    modelVersion: CUTOUT_MODEL.version,
  });
  const v13 = await new IndexerSupervisor({
    config,
    abi,
    store: v13Store,
    intervalSeconds: 15,
    modelVersion: CUTOUT_MODEL.version,
    now: () => clock,
    selectRpc,
  }).runAttempt();
  assert.equal(v13.snapshot.engineVersion, CUTOUT_MODEL.version);
  assert.equal(v13Store.getState().modelVersion, CUTOUT_MODEL.version);
  v13Store.close();

  const v14Store = new CanonicalStore({
    path,
    config,
    abi,
    now: () => clock,
    modelVersion: CUTOUT_MODEL_V1_4.version,
  });
  assert.equal(v14Store.getState().modelVersion, CUTOUT_MODEL_V1_4.version);
  assert.equal(v14Store.getState().status, "EMPTY");
  assert.equal(
    (v14Store.database.prepare("SELECT COUNT(*) AS count FROM snapshots").get() as { count: number }).count,
    0,
  );
  const v14 = await new IndexerSupervisor({
    config,
    abi,
    store: v14Store,
    intervalSeconds: 15,
    modelVersion: CUTOUT_MODEL_V1_4.version,
    now: () => clock,
    selectRpc,
  }).runAttempt();
  assert.equal(v14.snapshot.engineVersion, CUTOUT_MODEL_V1_4.version);
  assert.equal(v14.snapshot.withdrawalObservations?.length, 1);
  v14Store.close();

  assert.throws(
    () => new CanonicalStore({
      path,
      config,
      abi,
      readOnly: true,
      modelVersion: CUTOUT_MODEL.version,
    }),
    (error: unknown) => error instanceof DataLayerError && error.code === "MODEL_VERSION_MISMATCH",
  );
});

test("the v1.4 supervisor requests the full model horizon and the wallet execution gate remains deposit-only", async (t) => {
  const clock = fixtureBlockTimestamp(8_978_978) + 1;
  const store = new CanonicalStore({ path: temporaryDatabase(t), config, abi, now: () => clock });
  t.after(() => store.close());
  const rpc = new ReplayRpc(replay, 8_978_978);
  let requestedBoundary: number | undefined;
  const expectedBoundary = clock - CUTOUT_MODEL_V1_4.observationSeconds - 600;
  const originalGetBlock = rpc.getBlock.bind(rpc);
  rpc.getBlock = async (blockNumber) => {
    const block = await originalGetBlock(blockNumber);
    if (block.timestamp <= expectedBoundary) requestedBoundary ??= block.timestamp;
    return block;
  };
  const supervisor = new IndexerSupervisor({
    config,
    abi,
    store,
    intervalSeconds: 15,
    historyBufferSeconds: 600,
    modelVersion: CUTOUT_MODEL_V1_4.version,
    now: () => clock,
    selectRpc: async () => ({ provider: "primary", rpc, degraded: false, providerStates: [] }),
  });
  const indexed = await supervisor.runAttempt();
  assert.equal(indexed.snapshot.requiredFromTimestamp, expectedBoundary);
  assert.ok(requestedBoundary !== undefined && requestedBoundary <= expectedBoundary);
  assert.equal(indexed.snapshot.freshnessPolicyVersion, FRESHNESS_POLICY.version);

  assert.throws(
    () => validateSingleDepositAction([{
      type: "withdraw",
      token: replay.token,
      amount: "0x64",
      recipient: replay.account,
    }]),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "UNSUPPORTED_ACTION",
  );
});

test("a configured v1.4 service fails closed before any snapshot exists", (t) => {
  const clock = fixtureBlockTimestamp(8_978_978) + 1;
  const store = new CanonicalStore({ path: temporaryDatabase(t), config, abi, now: () => clock });
  t.after(() => store.close());
  const response = new PreflightService(store, config, abi, {
    now: () => clock,
    modelVersion: CUTOUT_MODEL_V1_4.version,
  }).preflight(wireWithdraw({ observedBlock: 8_978_978 }, clock));
  assert.equal(response.status, "NO_CONFIDENT_RECOMMENDATION");
  assert.equal(response.modelVersion, CUTOUT_MODEL_V1_4.version);
  assert.equal("decision" in response, false);
  assert.equal("riskBand" in response, false);
});

test("the preflight service fails closed when its configured model and active snapshot disagree", async (t) => {
  const clock = fixtureBlockTimestamp(8_978_978) + 1;
  const store = new CanonicalStore({ path: temporaryDatabase(t), config, abi, now: () => clock });
  t.after(() => store.close());
  const rpc = new ReplayRpc(replay, 8_978_978);
  const indexed = await new IndexerSupervisor({
    config,
    abi,
    store,
    intervalSeconds: 15,
    modelVersion: CUTOUT_MODEL.version,
    now: () => clock,
    selectRpc: async () => ({ provider: "primary", rpc, degraded: false, providerStates: [] }),
  }).runAttempt();

  const response = new PreflightService(store, config, abi, {
    now: () => clock,
    modelVersion: CUTOUT_MODEL_V1_4.version,
  }).preflight(wireWithdraw(indexed.snapshot, clock));

  assert.equal(response.status, "NO_CONFIDENT_RECOMMENDATION");
  assert.equal(response.modelVersion, CUTOUT_MODEL_V1_4.version);
  if (response.status === "NO_CONFIDENT_RECOMMENDATION") {
    assert.equal(response.error.code, "MODEL_VERSION_MISMATCH");
    assert.equal(response.snapshotHash, null);
    assert.equal("decision" in response, false);
    assert.equal("riskBand" in response, false);
  }
});
