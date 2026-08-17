import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { preflightLogEntry, routePreflightRequest } from "../src/api/http.js";
import { PreflightService } from "../src/api/preflight.js";
import { CUTOUT_MODEL } from "../src/engine/constants.js";
import { asDataLayerError, DataLayerError } from "../src/indexer/errors.js";
import { IncrementalPublicIndexer } from "../src/indexer/indexer.js";
import { CanonicalStore } from "../src/indexer/store.js";
import { loadPoolAbiFixture, reviewPoolAbi } from "../src/starknet/abi.js";
import { mainnetConfig } from "../src/starknet/config.js";
import { hashPublicSnapshot } from "../src/starknet/snapshot.js";
import type { PublicSnapshot } from "../src/starknet/types.js";
import { loadReplayFixture, ReplayRpc, type ReplayFixture } from "./helpers/replay-rpc.js";

const replay = await loadReplayFixture();
const poolFixture = await loadPoolAbiFixture();
const abi = reviewPoolAbi(poolFixture);
const config = mainnetConfig({
  CHAIN_ID: replay.chainId,
  POOL_ADDRESS: replay.poolAddress,
  RPC_URL: "https://fixture.invalid",
  CUTOUT_RPC_RANGE_BLOCKS: "3",
});

function temporaryDatabase(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "cutout-m2-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "cutout.sqlite");
}

function blockTimestamp(
  fixture: ReplayFixture,
  blockNumber: number,
  branch: keyof ReplayFixture["branches"] = "canonical",
): number {
  const block = fixture.branches[branch].blocks.find(
    (candidate) => candidate.blockNumber === blockNumber,
  );
  if (block === undefined) throw new Error(`missing fixture block ${blockNumber}`);
  return block.timestamp;
}

function requiredFrom(now: number): number {
  return now - CUTOUT_MODEL.observationSeconds - 600;
}

function openStore(path: string, now: () => number): CanonicalStore {
  return new CanonicalStore({ path, config, abi, now });
}

function createIndexer(
  rpc: ReplayRpc,
  store: CanonicalStore,
  now: () => number,
): IncrementalPublicIndexer {
  return new IncrementalPublicIndexer(rpc, store, {
    config,
    abi,
    maxRangeBlocks: 3,
    reorgWindowBlocks: 32,
    now,
  });
}

function createService(store: CanonicalStore, now: number): PreflightService {
  return new PreflightService(store, config, abi, { now: () => now });
}

function wireIntent(snapshot: PublicSnapshot, now: number, overrides: Record<string, unknown> = {}) {
  return {
    action: "shield",
    chainId: config.chainId,
    account: replay.account,
    token: replay.token,
    amount: "100",
    evaluationBlock: snapshot.observedBlock,
    evaluationTimestamp: now,
    flexibility: { mode: "exact" },
    deadline: now + 3_600,
    ...overrides,
  };
}

async function expectDataError(
  operation: () => Promise<unknown>,
  code: DataLayerError["code"],
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof DataLayerError);
    assert.equal(error.code, code);
    return true;
  });
}

test("initial bounded ingestion is atomic, paginated, private-state-free, and restartable", async (t) => {
  const path = temporaryDatabase(t);
  const rpc = new ReplayRpc(replay, 8_978_975);
  rpc.pageSize = 1;
  let clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(path, () => clock);
  const result = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.batchesCommitted, 2);
  assert.ok(result.eventPages >= 4);
  assert.ok(rpc.continuationRequests > 0);
  assert.equal(result.snapshot.observedBlock, rpc.headBlock);
  assert.equal(result.snapshot.depositObservations.length, 3);
  assert.equal(result.snapshot.viewingKeyRegistrationObservations.length, 1);
  assert.equal(result.snapshot.depositObservations[0]?.timestamp, 1_999_999_500);
  assert.equal(result.snapshotHash, hashPublicSnapshot(result.snapshot));
  assert.deepEqual(store.counts(), { blocks: 6, events: 4, batches: 2 });

  const registrationRow = store.database.prepare(`
    SELECT raw_public_json FROM public_events WHERE kind = 'viewing_key_set'
  `).get();
  assert.equal(typeof registrationRow?.raw_public_json, "string");
  const retained = String(registrationRow?.raw_public_json);
  assert.equal(retained.includes("0xfeed"), false);
  assert.equal(retained.includes("0xabc"), false);
  assert.equal(retained.includes("0xdef"), false);
  assert.equal(retained.includes("0x123"), false);

  store.close();
  clock += 1;
  const reopened = openStore(path, () => clock);
  t.after(() => reopened.close());
  const state = reopened.getState();
  assert.equal(state.status, "COMPLETE");
  assert.equal(state.indexedThroughBlock, 8_978_975);
  assert.equal(state.activeSnapshotHash, result.snapshotHash);
  assert.equal(reopened.loadCompleteSnapshot().observedBlockHash, "0x1005");
});

test("incremental ingestion advances the cursor and deterministic no-op replay keeps the snapshot hash", async (t) => {
  const path = temporaryDatabase(t);
  const rpc = new ReplayRpc(replay, 8_978_975);
  let clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(path, () => clock);
  t.after(() => store.close());
  const indexer = createIndexer(rpc, store, () => clock);
  await indexer.syncOnce(requiredFrom(clock));

  rpc.headBlock = 8_978_978;
  clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const incremental = await indexer.syncOnce(requiredFrom(clock));
  assert.equal(incremental.batchesCommitted, 1);
  assert.equal(incremental.snapshot.depositObservations.length, 4);
  assert.equal(incremental.snapshot.depositObservations.at(-1)?.amount, 200n);
  assert.equal(store.getState().indexedThroughBlock, rpc.headBlock);

  const replayed = await indexer.syncOnce(requiredFrom(clock));
  assert.equal(replayed.batchesCommitted, 0);
  assert.equal(replayed.snapshotHash, incremental.snapshotHash);
  assert.equal(store.counts().events, 5);
});

test("duplicate event shapes retain distinct identities and RPC ordering cannot change the snapshot hash", async (t) => {
  const clock = blockTimestamp(replay, 8_978_975) + 1;
  const firstPath = temporaryDatabase(t);
  const firstRpc = new ReplayRpc(replay, 8_978_975);
  firstRpc.pageSize = 2;
  const firstStore = openStore(firstPath, () => clock);
  t.after(() => firstStore.close());
  const first = await createIndexer(firstRpc, firstStore, () => clock).syncOnce(requiredFrom(clock));

  const secondPath = temporaryDatabase(t);
  const secondRpc = new ReplayRpc(replay, 8_978_975);
  secondRpc.pageSize = 2;
  secondRpc.reverseEventOrder = true;
  const secondStore = openStore(secondPath, () => clock);
  t.after(() => secondStore.close());
  const second = await createIndexer(secondRpc, secondStore, () => clock).syncOnce(requiredFrom(clock));

  assert.equal(first.snapshotHash, second.snapshotHash);
  const duplicates = first.snapshot.depositObservations.filter(
    (event) => event.transactionHash === "0xa3",
  );
  assert.deepEqual(duplicates.map((event) => event.eventIndex), [0, 1]);
  assert.equal(new Set(duplicates.map((event) => event.eventId)).size, 2);
});

test("a fork rolls back to the latest retained common ancestor and replays canonical events", async (t) => {
  const path = temporaryDatabase(t);
  const rpc = new ReplayRpc(replay, 8_978_978);
  let clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(path, () => clock);
  t.after(() => store.close());
  const indexer = createIndexer(rpc, store, () => clock);
  const before = await indexer.syncOnce(requiredFrom(clock));
  assert.equal(before.snapshot.depositObservations.at(-1)?.transactionHash, "0xa7");

  rpc.branchName = "reorg";
  clock = blockTimestamp(replay, rpc.headBlock, "reorg") + 1;
  const after = await indexer.syncOnce(requiredFrom(clock));
  assert.deepEqual(after.reorg, {
    detected: true,
    rolledBackToBlock: 8_978_975,
    fullReplay: false,
  });
  assert.notEqual(after.snapshotHash, before.snapshotHash);
  assert.equal(after.snapshot.observedBlockHash, "0x2008");
  assert.equal(after.snapshot.depositObservations.at(-1)?.transactionHash, "0xb7");
  assert.equal(
    after.snapshot.depositObservations.some((event) => event.transactionHash === "0xa7"),
    false,
  );
});

test("schema, RPC, event, header, and history failures stop publication", async (t) => {
  assert.equal(asDataLayerError(new TypeError("fetch failed")).code, "RPC_UNAVAILABLE");
  await t.test("unexpected selector", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_975);
    rpc.unknownSelector = true;
    const clock = blockTimestamp(replay, rpc.headBlock) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    await expectDataError(
      () => createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock)),
      "POOL_SCHEMA_MISMATCH",
    );
    assert.equal(store.getState().status, "ERROR");
  });

  await t.test("pool class hash change", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_975);
    rpc.classHashOverride = "0xdead";
    const clock = blockTimestamp(replay, rpc.headBlock) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    await expectDataError(
      () => createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock)),
      "POOL_SCHEMA_MISMATCH",
    );
  });

  await t.test("missing event block header", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_975);
    rpc.omittedBlocks.add(8_978_974);
    const clock = blockTimestamp(replay, rpc.headBlock) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    await expectDataError(
      () => createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock)),
      "INCONSISTENT_BLOCK_DATA",
    );
  });

  await t.test("RPC unavailable", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_975);
    rpc.unavailable = true;
    const clock = blockTimestamp(replay, rpc.headBlock) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    await expectDataError(
      () => createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock)),
      "RPC_UNAVAILABLE",
    );
  });

  await t.test("insufficient historical coverage", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_975);
    const clock = blockTimestamp(replay, rpc.headBlock) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    await expectDataError(
      () => createIndexer(rpc, store, () => clock).syncOnce(1_000_000_000),
      "INSUFFICIENT_HISTORY",
    );
  });

  await t.test("publication-time index lag", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_979);
    rpc.headSequence = [8_978_975, 8_978_975, 8_978_979];
    const clock = blockTimestamp(replay, 8_978_975) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    await expectDataError(
      () => createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock)),
      "INDEX_LAG",
    );
    assert.equal(store.getState().lastErrorCode, "INDEX_LAG");
  });
});

test("preflight responses and decision IDs are deterministic from the complete snapshot", async (t) => {
  const rpc = new ReplayRpc(replay, 8_978_978);
  const clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(temporaryDatabase(t), () => clock);
  t.after(() => store.close());
  const indexed = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));
  const service = createService(store, clock);
  const request = wireIntent(indexed.snapshot, clock);
  const first = service.preflight(request);
  const second = service.preflight(structuredClone(request));

  assert.deepEqual(first, second);
  assert.equal(first.status, "AVAILABLE");
  if (first.status !== "AVAILABLE") return;
  assert.equal(first.snapshotHash, indexed.snapshotHash);
  assert.equal(first.modelVersion, "CUTOUT-v1.3");
  assert.equal(first.guardPolicyVersion, "GUARD_POLICY-v1");
  assert.equal(first.decision, "WARN");
  assert.equal(first.riskBand, "MEDIUM");
  assert.match(first.decisionId, /^0x[0-9a-f]{64}$/);
});

test("the HTTP contract exposes only POST /api/preflight and logs no raw intent fields", async (t) => {
  const rpc = new ReplayRpc(replay, 8_978_978);
  const clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(temporaryDatabase(t), () => clock);
  t.after(() => store.close());
  const indexed = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));
  const service = createService(store, clock);
  const response = routePreflightRequest(service, {
    method: "POST",
    url: "/api/preflight",
    body: wireIntent(indexed.snapshot, clock),
  });
  assert.equal(response.statusCode, 200);
  const body = response.body as { status: string; decisionId: string };
  assert.equal(body.status, "AVAILABLE");
  assert.match(body.decisionId, /^0x[0-9a-f]{64}$/);
  if (response.preflightResult === undefined) throw new Error("missing routed preflight result");
  const entry = preflightLogEntry(response.preflightResult, 1.25) as unknown as Record<string, unknown>;
  assert.equal("account" in entry, false);
  assert.equal("amount" in entry, false);

  assert.equal(routePreflightRequest(service, {
    method: "GET",
    url: "/api/preflight",
    body: null,
  }).statusCode, 405);
  assert.equal(routePreflightRequest(service, {
    method: "POST",
    url: "/anything-else",
    body: null,
  }).statusCode, 404);
});

test("stale, lagging, partial, corrupt, and failed indexes never return LOW or ALLOW", async (t) => {
  await t.test("backdated client timestamp", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_978);
    const clock = blockTimestamp(replay, rpc.headBlock) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    const indexed = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));
    const result = createService(store, clock + 121).preflight(
      wireIntent(indexed.snapshot, clock),
    );
    assert.equal(result.status, "NO_CONFIDENT_RECOMMENDATION");
    if (result.status !== "NO_CONFIDENT_RECOMMENDATION") return;
    assert.equal(result.error.code, "INVALID_INTENT");
    assert.equal("decision" in result, false);
  });

  await t.test("stale snapshot", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_978);
    const clock = blockTimestamp(replay, rpc.headBlock) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    const indexed = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));
    const staleNow = indexed.snapshot.indexedThroughTimestamp + 121;
    const result = createService(store, staleNow).preflight(
      wireIntent(indexed.snapshot, staleNow),
    );
    assert.equal(result.status, "NO_CONFIDENT_RECOMMENDATION");
    if (result.status !== "NO_CONFIDENT_RECOMMENDATION") return;
    assert.equal(result.error.code, "STALE_RPC");
    assert.equal("decision" in result, false);
    assert.equal("riskBand" in result, false);
  });

  await t.test("index lag", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_978);
    const clock = blockTimestamp(replay, rpc.headBlock) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    const indexed = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));
    const head = replay.branches.canonical.blocks.find((block) => block.blockNumber === 8_978_979);
    if (head === undefined) throw new Error("missing lag fixture head");
    const lagged: PublicSnapshot = {
      ...indexed.snapshot,
      rpcHeadBlock: head.blockNumber,
      rpcHeadHash: head.blockHash,
      rpcHeadTimestamp: indexed.snapshot.indexedThroughTimestamp + 121,
      blockReferences: [
        ...indexed.snapshot.blockReferences,
        {
          blockNumber: head.blockNumber,
          blockHash: head.blockHash,
          parentHash: head.parentHash,
          timestamp: indexed.snapshot.indexedThroughTimestamp + 121,
        },
      ],
    };
    store.persistCompleteSnapshot(lagged);
    const result = createService(store, lagged.indexedThroughTimestamp + 1).preflight(
      wireIntent(lagged, lagged.indexedThroughTimestamp + 1),
    );
    assert.equal(result.status, "NO_CONFIDENT_RECOMMENDATION");
    if (result.status !== "NO_CONFIDENT_RECOMMENDATION") return;
    assert.equal(result.error.code, "INDEX_LAG");
  });

  await t.test("partial snapshot", async (t) => {
    const clock = blockTimestamp(replay, 8_978_975) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    store.setStatus("SYNCING");
    const result = createService(store, clock).preflight({
      action: "shield",
      chainId: config.chainId,
      account: replay.account,
      token: replay.token,
      amount: "100",
      evaluationBlock: 8_978_975,
      evaluationTimestamp: clock,
      flexibility: { mode: "exact" },
      deadline: clock + 3_600,
    });
    assert.equal(result.status, "NO_CONFIDENT_RECOMMENDATION");
    if (result.status !== "NO_CONFIDENT_RECOMMENDATION") return;
    assert.equal(result.error.code, "SNAPSHOT_UNAVAILABLE");
  });

  await t.test("corrupt snapshot", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_975);
    const clock = blockTimestamp(replay, rpc.headBlock) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    const indexed = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));
    store.database.prepare("UPDATE snapshots SET canonical_json = '{}' WHERE snapshot_hash = ?").run(
      indexed.snapshotHash,
    );
    const result = createService(store, clock).preflight(
      wireIntent(indexed.snapshot, clock),
    );
    assert.equal(result.status, "NO_CONFIDENT_RECOMMENDATION");
    if (result.status !== "NO_CONFIDENT_RECOMMENDATION") return;
    assert.equal(result.error.code, "INDEX_CORRUPT");
  });

  await t.test("failed indexer", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_975);
    rpc.classHashOverride = "0xdead";
    const clock = blockTimestamp(replay, rpc.headBlock) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    await expectDataError(
      () => createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock)),
      "POOL_SCHEMA_MISMATCH",
    );
    const result = createService(store, clock).preflight(
      wireIntent({ observedBlock: rpc.headBlock } as PublicSnapshot, clock),
    );
    assert.equal(result.status, "NO_CONFIDENT_RECOMMENDATION");
    if (result.status !== "NO_CONFIDENT_RECOMMENDATION") return;
    assert.equal(result.error.code, "POOL_SCHEMA_MISMATCH");
    assert.equal("decision" in result, false);
    assert.equal("riskBand" in result, false);
  });

  await t.test("persisted RPC failure", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_975);
    rpc.unavailable = true;
    const clock = blockTimestamp(replay, rpc.headBlock) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    await expectDataError(
      () => createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock)),
      "RPC_UNAVAILABLE",
    );
    const result = createService(store, clock).preflight({
      action: "shield",
      chainId: config.chainId,
      account: replay.account,
      token: replay.token,
      amount: "100",
      evaluationBlock: rpc.headBlock,
      evaluationTimestamp: clock,
      flexibility: { mode: "exact" },
      deadline: clock + 3_600,
    });
    assert.equal(result.status, "NO_CONFIDENT_RECOMMENDATION");
    if (result.status !== "NO_CONFIDENT_RECOMMENDATION") return;
    assert.equal(result.error.code, "RPC_UNAVAILABLE");
    assert.equal("decision" in result, false);
    assert.equal("riskBand" in result, false);
  });

  await t.test("model and pool snapshot identity mismatches", async (t) => {
    const rpc = new ReplayRpc(replay, 8_978_975);
    const clock = blockTimestamp(replay, rpc.headBlock) + 1;
    const store = openStore(temporaryDatabase(t), () => clock);
    t.after(() => store.close());
    const indexed = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));

    const wrongModel = { ...indexed.snapshot, engineVersion: "CUTOUT-v-next" };
    store.persistCompleteSnapshot(wrongModel);
    const modelResult = createService(store, clock).preflight(wireIntent(wrongModel, clock));
    assert.equal(modelResult.status, "NO_CONFIDENT_RECOMMENDATION");
    if (modelResult.status === "NO_CONFIDENT_RECOMMENDATION") {
      assert.equal(modelResult.error.code, "MODEL_VERSION_MISMATCH");
    }

    const wrongPool = { ...indexed.snapshot, poolClassHash: "0xdead" };
    store.persistCompleteSnapshot(wrongPool);
    const poolResult = createService(store, clock).preflight(wireIntent(wrongPool, clock));
    assert.equal(poolResult.status, "NO_CONFIDENT_RECOMMENDATION");
    if (poolResult.status === "NO_CONFIDENT_RECOMMENDATION") {
      assert.equal(poolResult.error.code, "POOL_SCHEMA_MISMATCH");
    }
  });
});

test("malformed and unsupported API intents fail before any confident decision", async (t) => {
  const rpc = new ReplayRpc(replay, 8_978_975);
  const clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(temporaryDatabase(t), () => clock);
  t.after(() => store.close());
  const indexed = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));
  const service = createService(store, clock);

  const malformed = service.preflight(wireIntent(indexed.snapshot, clock, { amount: 100 }));
  assert.equal(malformed.status, "NO_CONFIDENT_RECOMMENDATION");
  if (malformed.status === "NO_CONFIDENT_RECOMMENDATION") {
    assert.equal(malformed.error.code, "INVALID_INTENT");
  }

  const unsupportedAction = service.preflight(
    wireIntent(indexed.snapshot, clock, { action: "withdraw" }),
  );
  assert.equal(unsupportedAction.status, "NO_CONFIDENT_RECOMMENDATION");
  if (unsupportedAction.status === "NO_CONFIDENT_RECOMMENDATION") {
    assert.equal(unsupportedAction.error.code, "UNSUPPORTED_ACTION");
  }

  const unsupportedToken = service.preflight(
    wireIntent(indexed.snapshot, clock, { token: "0x777" }),
  );
  assert.equal(unsupportedToken.status, "NO_CONFIDENT_RECOMMENDATION");
  if (unsupportedToken.status === "NO_CONFIDENT_RECOMMENDATION") {
    assert.equal(unsupportedToken.error.code, "UNSUPPORTED_TOKEN");
  }
});
