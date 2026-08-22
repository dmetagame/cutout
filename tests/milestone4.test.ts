import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";

import { createPreflightHttpServer } from "../src/api/http.js";
import { PreflightService } from "../src/api/preflight.js";
import { CUTOUT_MODEL } from "../src/engine/constants.js";
import { DataLayerError } from "../src/indexer/errors.js";
import { IncrementalPublicIndexer } from "../src/indexer/indexer.js";
import { CanonicalStore } from "../src/indexer/store.js";
import type { RpcProviderState } from "../src/indexer/types.js";
import type { OperationalRpcConfig } from "../src/operations/config.js";
import {
  buildOperationalHealthReport,
  unavailableOperationalHealthReport,
} from "../src/operations/health.js";
import { IndexerSupervisor } from "../src/operations/indexer-supervisor.js";
import { OperationalMetrics } from "../src/operations/metrics.js";
import { RpcFailoverManager } from "../src/operations/rpc-failover.js";
import { loadPoolAbiFixture, reviewPoolAbi } from "../src/starknet/abi.js";
import { mainnetConfig } from "../src/starknet/config.js";
import type {
  PublicRpc,
  RpcBlockHeader,
  RpcEventFilter,
} from "../src/starknet/rpc.js";
import { hashPublicSnapshot } from "../src/starknet/snapshot.js";
import type { PublicSnapshot } from "../src/starknet/types.js";
import { loadReplayFixture, ReplayRpc, type ReplayFixture } from "./helpers/replay-rpc.js";

const replay = await loadReplayFixture();
const abi = reviewPoolAbi(await loadPoolAbiFixture());
const config = mainnetConfig({
  CHAIN_ID: replay.chainId,
  POOL_ADDRESS: replay.poolAddress,
  RPC_URL: "https://fixture.invalid",
  CUTOUT_RPC_RANGE_BLOCKS: "3",
});
const rpcConfig: OperationalRpcConfig = {
  primaryUrl: "https://primary.invalid/",
  secondaryUrl: "https://secondary.invalid/",
  timeoutMs: 1_000,
  initialBackoffMs: 10,
  maximumBackoffMs: 40,
};

function temporaryDirectory(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "cutout-m4-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
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

function openStore(path: string, now: () => number, readOnly = false): CanonicalStore {
  return new CanonicalStore({ path, config, abi, now, readOnly });
}

function createIndexer(
  rpc: PublicRpc,
  store: CanonicalStore,
  now: () => number,
  reorgWindowBlocks = 32,
): IncrementalPublicIndexer {
  return new IncrementalPublicIndexer(rpc, store, {
    config,
    abi,
    maxRangeBlocks: 3,
    reorgWindowBlocks,
    now,
    rpcProviderName: "primary",
  });
}

function providerHealth(
  provider: "primary" | "secondary",
  now: number,
  rpc: ReplayRpc,
  status: RpcProviderState["status"] = "HEALTHY",
): RpcProviderState {
  const block = replay.branches[rpc.branchName].blocks.find(
    (candidate) => candidate.blockNumber === rpc.headBlock,
  );
  if (block === undefined) throw new Error("fixture provider head is missing");
  return {
    provider,
    status,
    lastCheckedAt: now,
    lastSuccessAt: status === "HEALTHY" ? now : null,
    lastErrorCode: status === "HEALTHY" ? null : "RPC_UNAVAILABLE",
    chainId: replay.chainId,
    headBlock: block.blockNumber,
    headHash: block.blockHash,
    headTimestamp: block.timestamp,
  };
}

function rpcWithOverrides(
  base: PublicRpc,
  overrides: {
    readonly chainId?: string;
    readonly block?: (blockNumber: number, original: RpcBlockHeader) => RpcBlockHeader;
  },
): PublicRpc {
  return {
    getChainId: () => overrides.chainId === undefined ? base.getChainId() : Promise.resolve(overrides.chainId),
    getBlockNumber: () => base.getBlockNumber(),
    getBlock: async (blockNumber) => {
      const original = await base.getBlock(blockNumber);
      return overrides.block?.(blockNumber, original) ?? original;
    },
    getBlocks: async (blockNumbers) => Promise.all(
      blockNumbers.map(async (blockNumber) => {
        const original = await base.getBlock(blockNumber);
        return overrides.block?.(blockNumber, original) ?? original;
      }),
    ),
    getEvents: (filter: RpcEventFilter) => base.getEvents(filter),
    getClassHashAt: (blockNumber, contractAddress) => base.getClassHashAt(blockNumber, contractAddress),
    getClass: (classHash, blockNumber) => base.getClass(classHash, blockNumber),
  };
}

function wireIntent(snapshot: PublicSnapshot, now: number) {
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
  };
}

test("RPC selection cross-checks providers and fails over without mixing a sync attempt", async (t) => {
  await t.test("healthy providers select primary", async () => {
    const primary = new ReplayRpc(replay, 8_978_978);
    const secondary = new ReplayRpc(replay, 8_978_978);
    const manager = new RpcFailoverManager(rpcConfig, {
      expectedChainId: replay.chainId,
      clients: { primary, secondary },
      now: () => 2_000_000_000,
    });
    const selected = await manager.select();
    assert.equal(selected.provider, "primary");
    assert.equal(selected.degraded, false);
    assert.deepEqual(selected.providerStates.map((state) => state.status), ["HEALTHY", "HEALTHY"]);
  });

  await t.test("primary outage selects secondary", async () => {
    const primary = new ReplayRpc(replay, 8_978_978);
    primary.unavailable = true;
    const secondary = new ReplayRpc(replay, 8_978_978);
    let failures = 0;
    let failovers = 0;
    const manager = new RpcFailoverManager(rpcConfig, {
      expectedChainId: replay.chainId,
      clients: { primary, secondary },
      now: () => 2_000_000_000,
      onRpcFailure: () => { failures += 1; },
      onFailover: () => { failovers += 1; },
    });
    const selected = await manager.select();
    assert.equal(selected.provider, "secondary");
    assert.equal(selected.degraded, true);
    assert.equal(failures, 1);
    assert.equal(failovers, 1);
  });

  await t.test("secondary outage keeps primary but reports degraded redundancy", async () => {
    const primary = new ReplayRpc(replay, 8_978_978);
    const secondary = new ReplayRpc(replay, 8_978_978);
    secondary.unavailable = true;
    const manager = new RpcFailoverManager(rpcConfig, {
      expectedChainId: replay.chainId,
      clients: { primary, secondary },
      now: () => 2_000_000_000,
    });
    const selected = await manager.select();
    assert.equal(selected.provider, "primary");
    assert.equal(selected.degraded, true);
    assert.equal(selected.providerStates[1]?.status, "UNAVAILABLE");
  });

  await t.test("wrong network on primary selects validated secondary", async () => {
    const primaryBase = new ReplayRpc(replay, 8_978_978);
    const secondary = new ReplayRpc(replay, 8_978_978);
    const manager = new RpcFailoverManager(rpcConfig, {
      expectedChainId: replay.chainId,
      clients: {
        primary: rpcWithOverrides(primaryBase, { chainId: "0x534e5f5345504f4c4941" }),
        secondary,
      },
      now: () => 2_000_000_000,
    });
    const selected = await manager.select();
    assert.equal(selected.provider, "secondary");
    assert.equal(selected.providerStates[0]?.lastErrorCode, "CHAIN_ID_MISMATCH");
  });

  await t.test("canonical hash disagreement fails closed", async () => {
    const primary = new ReplayRpc(replay, 8_978_978);
    const secondaryBase = new ReplayRpc(replay, 8_978_978);
    const secondary = rpcWithOverrides(secondaryBase, {
      block: (blockNumber, original) => blockNumber === 8_978_978
        ? { ...original, blockHash: "0xdead" }
        : original,
    });
    const manager = new RpcFailoverManager(rpcConfig, {
      expectedChainId: replay.chainId,
      clients: { primary, secondary },
      now: () => 2_000_000_000,
    });
    await assert.rejects(
      () => manager.select(),
      (error: unknown) => error instanceof DataLayerError && error.code === "INCONSISTENT_BLOCK_DATA",
    );
  });

  await t.test("both providers unavailable remains unavailable", async () => {
    const primary = new ReplayRpc(replay, 8_978_978);
    const secondary = new ReplayRpc(replay, 8_978_978);
    primary.unavailable = true;
    secondary.unavailable = true;
    const manager = new RpcFailoverManager(rpcConfig, {
      expectedChainId: replay.chainId,
      clients: { primary, secondary },
      now: () => 2_000_000_000,
    });
    await assert.rejects(
      () => manager.select(),
      (error: unknown) => error instanceof DataLayerError && error.code === "RPC_UNAVAILABLE",
    );
  });
});

test("a runtime primary failure makes the next complete attempt use secondary", async () => {
  let clock = 2_000_000_000;
  const primary = new ReplayRpc(replay, 8_978_978);
  const secondary = new ReplayRpc(replay, 8_978_978);
  const manager = new RpcFailoverManager(rpcConfig, {
    expectedChainId: replay.chainId,
    clients: { primary, secondary },
    now: () => clock,
  });
  const first = await manager.select();
  assert.equal(first.provider, "primary");
  primary.unavailable = true;
  await assert.rejects(() => first.rpc.getBlock(8_978_978));
  primary.unavailable = false;
  clock += 1;
  const second = await manager.select();
  assert.equal(second.provider, "secondary");
});

test("supervision retries with bounded backoff and recovers the persisted cursor", async (t) => {
  const path = join(temporaryDirectory(t), "cutout.sqlite");
  const rpc = new ReplayRpc(replay, 8_978_978);
  const clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(path, () => clock);
  t.after(() => store.close());
  let selections = 0;
  const sleeps: number[] = [];
  let supervisor: IndexerSupervisor;
  supervisor = new IndexerSupervisor({
    config,
    abi,
    store,
    intervalSeconds: 5,
    initialBackoffMs: 10,
    maximumBackoffMs: 40,
    now: () => clock,
    selectRpc: async () => {
      selections += 1;
      if (selections === 1) throw new DataLayerError("RPC_UNAVAILABLE", "primary unavailable");
      return {
        provider: "secondary",
        rpc,
        degraded: true,
        providerStates: [],
      };
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      if (sleeps.length === 2) supervisor.requestStop();
    },
  });
  const result = await supervisor.run();
  assert.equal(result.attempts, 2);
  assert.deepEqual(sleeps, [10, 5_000]);
  assert.equal(result.lastResult?.status, "COMPLETE");
  const state = store.getState();
  assert.equal(state.status, "COMPLETE");
  assert.equal(state.activeRpcProvider, "secondary");
  assert.equal(state.lastSuccessfulBlock, rpc.headBlock);
  assert.equal(state.lastErrorCode, "RPC_UNAVAILABLE");
  assert.ok((state.lastSyncDurationMs ?? -1) >= 0);
});

test("routine catch-up and transient RPC failure retain only fresh complete evidence", async (t) => {
  const path = join(temporaryDirectory(t), "cutout.sqlite");
  const rpc = new ReplayRpc(replay, 8_978_976);
  let clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(path, () => clock);
  t.after(() => store.close());
  const initial = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));

  rpc.headBlock = 8_978_978;
  clock = blockTimestamp(replay, rpc.headBlock) + 1;
  let releaseHead: (() => void) | undefined;
  const headReleased = new Promise<void>((resolve) => {
    releaseHead = resolve;
  });
  let announceHead: (() => void) | undefined;
  const headRequested = new Promise<void>((resolve) => {
    announceHead = resolve;
  });
  let gateFirstHead = true;
  const gatedRpc: PublicRpc = {
    getChainId: () => rpc.getChainId(),
    getBlockNumber: async () => {
      if (gateFirstHead) {
        gateFirstHead = false;
        announceHead?.();
        await headReleased;
      }
      return rpc.getBlockNumber();
    },
    getBlock: (blockNumber) => rpc.getBlock(blockNumber),
    getBlocks: (blockNumbers) => rpc.getBlocks(blockNumbers),
    getEvents: (filter) => rpc.getEvents(filter),
    getClassHashAt: (blockNumber, contractAddress) =>
      rpc.getClassHashAt(blockNumber, contractAddress),
    getClass: (classHash, blockNumber) => rpc.getClass(classHash, blockNumber),
  };
  const commitBatch = store.commitBatch.bind(store);
  let checkedCommittedBatch = false;
  store.commitBatch = (batch) => {
    commitBatch(batch);
    assert.equal(store.getState().activeSnapshotHash, initial.snapshotHash);
    const afterBatchCommit = new PreflightService(store, config, abi, { now: () => clock })
      .preflight(wireIntent(initial.snapshot, clock));
    assert.equal(afterBatchCommit.status, "AVAILABLE");
    checkedCommittedBatch = true;
  };
  const catchingUp = createIndexer(gatedRpc, store, () => clock).syncOnce(requiredFrom(clock));
  await headRequested;

  assert.equal(store.getState().status, "SYNCING");
  assert.equal(store.getState().activeSnapshotHash, initial.snapshotHash);
  const duringSync = new PreflightService(store, config, abi, { now: () => clock })
    .preflight(wireIntent(initial.snapshot, clock));
  assert.equal(duringSync.status, "AVAILABLE");

  releaseHead?.();
  const updated = await catchingUp;
  assert.equal(checkedCommittedBatch, true);
  assert.notEqual(updated.snapshotHash, initial.snapshotHash);

  rpc.unavailable = true;
  clock += 1;
  await assert.rejects(
    () => createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock)),
    (error: unknown) => error instanceof DataLayerError && error.code === "RPC_UNAVAILABLE",
  );
  assert.equal(store.getState().status, "ERROR");
  assert.equal(store.getState().activeSnapshotHash, updated.snapshotHash);
  const duringOutage = new PreflightService(store, config, abi, { now: () => clock })
    .preflight(wireIntent(updated.snapshot, clock));
  assert.equal(duringOutage.status, "AVAILABLE");
  const outageHealth = buildOperationalHealthReport({
    store,
    config,
    abi,
    now: clock,
    apiMetrics: new OperationalMetrics().snapshot(),
  });
  assert.equal(outageHealth.status, "DEGRADED");
  assert.equal(outageHealth.ready, true);
  assert.equal(outageHealth.snapshot.status, "CURRENT_COMPLETE_SNAPSHOT");

  const staleNow = updated.snapshot.indexedThroughTimestamp + 121;
  const stale = new PreflightService(store, config, abi, { now: () => staleNow })
    .preflight(wireIntent(updated.snapshot, staleNow));
  assert.equal(stale.status, "NO_CONFIDENT_RECOMMENDATION");
  if (stale.status === "NO_CONFIDENT_RECOMMENDATION") {
    assert.equal(stale.error.code, "STALE_RPC");
    assert.equal("decision" in stale, false);
  }
});

test("unsafe recovery states withdraw the active snapshot immediately", async (t) => {
  const path = join(temporaryDirectory(t), "cutout.sqlite");
  const rpc = new ReplayRpc(replay, 8_978_978);
  const clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(path, () => clock);
  t.after(() => store.close());
  const indexed = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));

  store.setStatus("REORGING");
  assert.equal(store.getState().activeSnapshotHash, null);
  assert.throws(
    () => store.loadCompleteSnapshot(),
    (error: unknown) => error instanceof DataLayerError && error.code === "SNAPSHOT_UNAVAILABLE",
  );

  const restoredHash = store.persistCompleteSnapshot(indexed.snapshot);
  assert.equal(store.getState().activeSnapshotHash, restoredHash);
  store.setStatus("ERROR", "POOL_SCHEMA_MISMATCH");
  assert.equal(store.getState().activeSnapshotHash, null);
});

test("snapshot retention keeps a bounded operational history", async (t) => {
  const path = join(temporaryDirectory(t), "cutout.sqlite");
  const rpc = new ReplayRpc(replay, 8_978_975);
  let clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(path, () => clock);
  t.after(() => store.close());

  const snapshotHashes: string[] = [];
  for (const headBlock of [8_978_975, 8_978_976, 8_978_977, 8_978_978]) {
    rpc.headBlock = headBlock;
    clock = blockTimestamp(replay, headBlock) + 1;
    const result = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));
    snapshotHashes.push(result.snapshotHash);
  }

  const rows = store.database.prepare(`
    SELECT snapshot_hash
    FROM snapshots
    ORDER BY created_at DESC, observed_block DESC, snapshot_hash DESC
  `).all() as Array<{ snapshot_hash: string }>;
  assert.equal(rows.length, 3);
  assert.deepEqual(
    new Set(rows.map((row) => row.snapshot_hash)),
    new Set(snapshotHashes.slice(-3)),
  );
  assert.equal(store.getState().activeSnapshotHash, snapshotHashes.at(-1));
});

test("supervisor shutdown interrupts the active polling sleep", async (t) => {
  const path = join(temporaryDirectory(t), "cutout.sqlite");
  const rpc = new ReplayRpc(replay, 8_978_978);
  const clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(path, () => clock);
  t.after(() => store.close());
  let announceSleep: (() => void) | undefined;
  const sleepStarted = new Promise<void>((resolve) => {
    announceSleep = resolve;
  });
  let releaseSleep: (() => void) | undefined;
  const supervisor = new IndexerSupervisor({
    config,
    abi,
    store,
    intervalSeconds: 5,
    now: () => clock,
    selectRpc: async () => ({
      provider: "primary",
      rpc,
      degraded: false,
      providerStates: [],
    }),
    sleep: () => new Promise<void>((resolve) => {
      releaseSleep = resolve;
      announceSleep?.();
    }),
  });
  const running = supervisor.run();
  await sleepStarted;
  supervisor.requestStop();
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("supervisor did not stop promptly")), 250);
  });
  const result = await Promise.race([running, timedOut]);
  if (timeout !== undefined) clearTimeout(timeout);
  releaseSleep?.();
  assert.equal(result.status, "STOPPED");
  assert.equal(result.attempts, 1);
});

test("schema v1 databases migrate in place without losing the frozen identity", (t) => {
  const path = join(temporaryDirectory(t), "cutout.sqlite");
  const clock = 2_000_000_000;
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT INTO schema_meta(key, value) VALUES('schema_version', '1');
    CREATE TABLE indexer_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      status TEXT NOT NULL,
      chain_id TEXT NOT NULL,
      pool_address TEXT NOT NULL,
      pool_class_hash TEXT NOT NULL,
      abi_fixture_version TEXT NOT NULL,
      source_from_block INTEGER,
      source_from_hash TEXT,
      source_from_timestamp INTEGER,
      required_from_timestamp INTEGER,
      indexed_through_block INTEGER,
      indexed_through_hash TEXT,
      indexed_through_timestamp INTEGER,
      active_snapshot_hash TEXT,
      last_error_code TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  legacy.prepare(`
    INSERT INTO indexer_state(
      singleton, status, chain_id, pool_address, pool_class_hash,
      abi_fixture_version, updated_at
    ) VALUES(1, 'EMPTY', ?, ?, ?, ?, ?)
  `).run(config.chainId, config.poolAddress, abi.classHash, abi.fixtureVersion, clock);
  legacy.close();

  const migrated = openStore(path, () => clock);
  const state = migrated.getState();
  assert.equal(state.modelVersion, CUTOUT_MODEL.version);
  assert.equal(state.chainId, config.chainId);
  assert.equal(state.poolAddress, config.poolAddress);
  assert.equal(state.rpcFailureCount, 0);
  assert.equal(state.rpcFailoverCount, 0);
  assert.equal(state.lastSuccessfulSyncAt, null);
  const version = migrated.database
    .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
    .get() as { value: string };
  assert.equal(version.value, "4");
  const withdrawalTable = migrated.database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'public_withdrawals'")
    .get() as { name: string } | undefined;
  assert.equal(withdrawalTable?.name, "public_withdrawals");
  migrated.close();
});

test("deep reorg recovery resets and deterministically replays beyond the retained window", async (t) => {
  const path = join(temporaryDirectory(t), "cutout.sqlite");
  const rpc = new ReplayRpc(replay, 8_978_978);
  let clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(path, () => clock);
  t.after(() => store.close());
  const before = await createIndexer(rpc, store, () => clock, 2).syncOnce(requiredFrom(clock));
  rpc.branchName = "reorg";
  clock = blockTimestamp(replay, rpc.headBlock, "reorg") + 1;
  const after = await createIndexer(rpc, store, () => clock, 2).syncOnce(requiredFrom(clock));
  assert.equal(after.reorg.detected, true);
  assert.equal(after.reorg.fullReplay, true);
  assert.notEqual(after.snapshotHash, before.snapshotHash);
  assert.equal(after.snapshot.observedBlockHash, "0x2008");
});

test("restart, withdrawn snapshot durability, API restart, and backup restore are deterministic", async (t) => {
  const directory = temporaryDirectory(t);
  const path = join(directory, "cutout.sqlite");
  const backupPath = join(directory, "backup.sqlite");
  const rpc = new ReplayRpc(replay, 8_978_978);
  const clock = blockTimestamp(replay, rpc.headBlock) + 1;
  let store = openStore(path, () => clock);
  const indexed = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));
  const service = new PreflightService(store, config, abi, { now: () => clock });
  const first = service.preflight(wireIntent(indexed.snapshot, clock));
  await store.backupTo(backupPath);
  assert.equal(existsSync(backupPath), true);
  store.close();

  store = openStore(path, () => clock);
  assert.equal(hashPublicSnapshot(store.loadCompleteSnapshot()), indexed.snapshotHash);
  const restarted = new PreflightService(store, config, abi, { now: () => clock })
    .preflight(wireIntent(indexed.snapshot, clock));
  assert.deepEqual(restarted, first);
  store.setStatus("ERROR", "POOL_SCHEMA_MISMATCH");
  assert.throws(
    () => store.loadCompleteSnapshot(),
    (error: unknown) => error instanceof DataLayerError && error.code === "POOL_SCHEMA_MISMATCH",
  );
  assert.equal(hashPublicSnapshot(store.loadLatestPersistedSnapshot() as PublicSnapshot), indexed.snapshotHash);
  store.close();

  const restored = openStore(backupPath, () => clock, true);
  assert.equal(hashPublicSnapshot(restored.loadCompleteSnapshot()), indexed.snapshotHash);
  assert.equal(restored.databaseIntegrity(), "ok");
  restored.close();
});

test("health distinguishes current, degraded, stale, schema mismatch, and no database", async (t) => {
  const directory = temporaryDirectory(t);
  const path = join(directory, "cutout.sqlite");
  const rpc = new ReplayRpc(replay, 8_978_978);
  const clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(path, () => clock);
  t.after(() => store.close());
  await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));
  store.recordRpcProviderState(providerHealth("primary", clock, rpc));
  store.recordRpcProviderState(providerHealth("secondary", clock, rpc));
  const metrics = new OperationalMetrics();
  metrics.recordPreflight(12.5, false);
  let deepIntegrityChecks = 0;
  store.databaseIntegrity = () => {
    deepIntegrityChecks += 1;
    return "error";
  };
  const loadCompleteSnapshot = store.loadCompleteSnapshot.bind(store);
  let activeSnapshotLoaded = false;
  store.loadCompleteSnapshot = () => {
    const snapshot = loadCompleteSnapshot();
    activeSnapshotLoaded = true;
    return snapshot;
  };

  const healthy = buildOperationalHealthReport({
    store,
    config,
    abi,
    now: () => {
      assert.equal(activeSnapshotLoaded, true);
      return clock;
    },
    apiMetrics: metrics.snapshot(),
  });
  assert.equal(healthy.status, "HEALTHY");
  assert.equal(healthy.ready, true);
  assert.equal(healthy.snapshot.status, "CURRENT_COMPLETE_SNAPSHOT");
  assert.equal(healthy.database.mode, "read-write");
  assert.equal(healthy.database.checkScope, "ACTIVE_PATH");
  assert.equal(deepIntegrityChecks, 0);
  const serialized = JSON.stringify(healthy);
  assert.equal(serialized.includes(replay.account), false);
  assert.equal(serialized.includes('"amount"'), false);

  store.recordRpcProviderState(providerHealth("secondary", clock, rpc, "UNAVAILABLE"));
  const degraded = buildOperationalHealthReport({
    store,
    config,
    abi,
    now: clock,
    apiMetrics: metrics.snapshot(),
  });
  assert.equal(degraded.status, "DEGRADED");
  assert.equal(degraded.ready, true);

  const stale = buildOperationalHealthReport({
    store,
    config,
    abi,
    now: clock + 121,
    apiMetrics: metrics.snapshot(),
  });
  assert.equal(stale.ready, false);
  assert.equal(stale.snapshot.status, "STALE_SNAPSHOT");

  store.setStatus("ERROR", "POOL_SCHEMA_MISMATCH");
  const mismatch = buildOperationalHealthReport({
    store,
    config,
    abi,
    now: clock,
    apiMetrics: metrics.snapshot(),
  });
  assert.equal(mismatch.status, "SCHEMA_MISMATCH");
  assert.equal(mismatch.ready, false);

  const noDatabase = unavailableOperationalHealthReport(
    clock,
    "SNAPSHOT_UNAVAILABLE",
    metrics.snapshot(),
  );
  assert.equal(noDatabase.status, "UNAVAILABLE");
  assert.equal(noDatabase.ready, false);
  assert.throws(
    () => openStore(join(directory, "missing.sqlite"), () => clock, true),
    /database|SQLITE|open/i,
  );
});

test("corrupt cursor and corrupt snapshot never become a current health or ALLOW result", async (t) => {
  const path = join(temporaryDirectory(t), "cutout.sqlite");
  const rpc = new ReplayRpc(replay, 8_978_978);
  const clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(path, () => clock);
  t.after(() => store.close());
  const indexed = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));
  store.database.prepare(`
    UPDATE indexer_state
    SET indexed_through_block = ?, indexed_through_hash = ?
    WHERE singleton = 1
  `).run(9_999_999, "0xdead");
  await assert.rejects(
    () => createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock)),
    (error: unknown) => error instanceof DataLayerError,
  );
  assert.equal(store.getState().status, "ERROR");

  store.database.prepare("UPDATE snapshots SET canonical_json = '{}' WHERE snapshot_hash = ?")
    .run(indexed.snapshotHash);
  assert.throws(() => store.loadLatestPersistedSnapshot(), DataLayerError);
  const service = new PreflightService(store, config, abi, { now: () => clock });
  const result = service.preflight(wireIntent(indexed.snapshot, clock));
  assert.equal(result.status, "NO_CONFIDENT_RECOMMENDATION");
});

test("the standalone health endpoint is no-store and reflects readiness", async (t) => {
  const path = join(temporaryDirectory(t), "cutout.sqlite");
  const rpc = new ReplayRpc(replay, 8_978_978);
  const clock = blockTimestamp(replay, rpc.headBlock) + 1;
  const store = openStore(path, () => clock);
  t.after(() => store.close());
  const indexed = await createIndexer(rpc, store, () => clock).syncOnce(requiredFrom(clock));
  store.recordRpcProviderState(providerHealth("primary", clock, rpc));
  store.recordRpcProviderState(providerHealth("secondary", clock, rpc));
  const service = new PreflightService(store, config, abi, { now: () => clock });
  const metrics = new OperationalMetrics();
  const server = createPreflightHttpServer(service, () => {}, () => {
    const report = buildOperationalHealthReport({
      store,
      config,
      abi,
      now: clock,
      apiMetrics: metrics.snapshot(),
    });
    return { statusCode: report.ready ? 200 : 503, body: report };
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server address unavailable");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as { ready: boolean; snapshot: { snapshotHash: string } };
  assert.equal(body.ready, true);
  assert.equal(body.snapshot.snapshotHash, indexed.snapshotHash);
});

test("operational metrics are aggregate-only and count failures", () => {
  const metrics = new OperationalMetrics();
  metrics.recordPreflight(10, false);
  metrics.recordPreflight(20, true);
  assert.deepEqual(metrics.snapshot(), {
    preflight: {
      count: 2,
      failureCount: 1,
      totalDurationMs: 30,
      averageDurationMs: 15,
      lastDurationMs: 20,
    },
  });
});

test("server and indexer sources contain no signing or wallet submission path", () => {
  const serverFiles = [
    "src/api/http.ts",
    "src/api/preflight.ts",
    "src/operations/health.ts",
    "src/operations/indexer-supervisor.ts",
    "scripts/indexer.ts",
    "scripts/preflight-api.ts",
    "apps/web/app/api/preflight/route.ts",
    "apps/web/app/api/health/route.ts",
    "apps/web/lib/server-runtime.ts",
  ];
  const source = serverFiles.map((path) => readFileSync(path, "utf8")).join("\n");
  assert.equal(source.includes("strk20InvokeTransaction"), false);
  assert.equal(source.includes("WalletAccountV6"), false);
  assert.equal(source.includes("privateKey"), false);
  assert.equal(source.includes("seedPhrase"), false);
  assert.equal(source.includes("viewingKey"), false);
  assert.equal(source.includes("CUTOUT_RPC_PRIMARY_URL"), false);
  assert.equal(source.includes("CUTOUT_RPC_SECONDARY_URL"), false);
  assert.match(
    readFileSync("apps/web/lib/server-runtime.ts", "utf8"),
    /process\.env\.NODE_ENV === "production"[^\n]+Date\.now/,
  );
});
