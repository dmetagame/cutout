import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";

import type { ReviewedPoolAbi } from "../starknet/abi.js";
import type { StarknetSpikeConfig } from "../starknet/config.js";
import { normalizeAddress, normalizeFelt, normalizeTransactionHash } from "../starknet/felt.js";
import { canonicalSnapshotJson, hashPublicSnapshot } from "../starknet/snapshot.js";
import type {
  BlockReference,
  PublicDepositObservation,
  PublicRegistrationObservation,
  PublicSnapshot,
  SnapshotHash,
} from "../starknet/types.js";
import {
  DataLayerError,
  isDataLayerErrorCode,
  isTransientSnapshotAvailabilityError,
} from "./errors.js";
import type {
  IndexBatch,
  IndexedPoolEvent,
  IndexerState,
  IndexerStatus,
  RpcProviderName,
  RpcProviderState,
} from "./types.js";

const SCHEMA_VERSION = 2;
const MAX_SNAPSHOT_HISTORY = 3;

type SqlRow = Record<string, null | number | bigint | string | Uint8Array>;

function integer(row: SqlRow, key: string): number;
function integer(row: SqlRow, key: string, nullable: true): number | null;
function integer(row: SqlRow, key: string, nullable = false): number | null {
  const value = row[key];
  if (value === null && nullable) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new DataLayerError("INDEX_CORRUPT", `Database field ${key} is invalid.`);
  }
  return value;
}

function text(row: SqlRow, key: string): string;
function text(row: SqlRow, key: string, nullable: true): string | null;
function text(row: SqlRow, key: string, nullable = false): string | null {
  const value = row[key];
  if (value === null && nullable) return null;
  if (typeof value !== "string") {
    throw new DataLayerError("INDEX_CORRUPT", `Database field ${key} is invalid.`);
  }
  return value;
}

function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function readTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function batchId(batch: IndexBatch): string {
  const eventIds = batch.events.map((event) => event.normalized.observation.eventId).sort();
  const body = JSON.stringify({
    fromBlock: batch.fromBlock,
    throughBlock: batch.throughBlock,
    fromHash: batch.fromHeader.blockHash,
    throughHash: batch.throughHeader.blockHash,
    eventIds,
    eventPages: batch.eventPages,
  });
  return `0x${createHash("sha256").update(body).digest("hex")}`;
}

function stateFromRow(row: SqlRow): IndexerState {
  const status = text(row, "status") as IndexerStatus;
  if (!["EMPTY", "SYNCING", "REORGING", "COMPLETE", "ERROR"].includes(status)) {
    throw new DataLayerError("INDEX_CORRUPT", "Indexer status is invalid.");
  }
  const activeRpcProvider = text(row, "active_rpc_provider", true);
  if (
    activeRpcProvider !== null &&
    activeRpcProvider !== "primary" &&
    activeRpcProvider !== "secondary"
  ) {
    throw new DataLayerError("INDEX_CORRUPT", "Stored RPC provider identity is invalid.");
  }
  return {
    status,
    chainId: normalizeFelt(text(row, "chain_id"), "stored chain id"),
    poolAddress: normalizeAddress(text(row, "pool_address"), "stored pool address"),
    poolClassHash: normalizeFelt(text(row, "pool_class_hash"), "stored class hash"),
    poolAbiFixtureVersion: text(row, "abi_fixture_version"),
    sourceFromBlock: integer(row, "source_from_block", true),
    sourceFromHash: text(row, "source_from_hash", true),
    sourceFromTimestamp: integer(row, "source_from_timestamp", true),
    requiredFromTimestamp: integer(row, "required_from_timestamp", true),
    indexedThroughBlock: integer(row, "indexed_through_block", true),
    indexedThroughHash: text(row, "indexed_through_hash", true),
    indexedThroughTimestamp: integer(row, "indexed_through_timestamp", true),
    activeSnapshotHash: text(row, "active_snapshot_hash", true) as SnapshotHash | null,
    lastErrorCode: text(row, "last_error_code", true),
    lastErrorAt: integer(row, "last_error_at", true),
    lastSuccessfulSyncAt: integer(row, "last_successful_sync_at", true),
    lastSuccessfulBlock: integer(row, "last_successful_block", true),
    lastSyncDurationMs: integer(row, "last_sync_duration_ms", true),
    lastBatchDurationMs: integer(row, "last_batch_duration_ms", true),
    lastSnapshotDurationMs: integer(row, "last_snapshot_duration_ms", true),
    rpcFailureCount: integer(row, "rpc_failure_count"),
    rpcFailoverCount: integer(row, "rpc_failover_count"),
    activeRpcProvider,
    updatedAt: integer(row, "updated_at") as number,
  };
}

function providerStateFromRow(row: SqlRow): RpcProviderState {
  const provider = text(row, "provider");
  if (provider !== "primary" && provider !== "secondary") {
    throw new DataLayerError("INDEX_CORRUPT", "Stored RPC provider name is invalid.");
  }
  const status = text(row, "status");
  if (status !== "HEALTHY" && status !== "DEGRADED" && status !== "UNAVAILABLE") {
    throw new DataLayerError("INDEX_CORRUPT", "Stored RPC provider health is invalid.");
  }
  return {
    provider,
    status,
    lastCheckedAt: integer(row, "last_checked_at", true),
    lastSuccessAt: integer(row, "last_success_at", true),
    lastErrorCode: text(row, "last_error_code", true),
    chainId: text(row, "chain_id", true),
    headBlock: integer(row, "head_block", true),
    headHash: text(row, "head_hash", true),
    headTimestamp: integer(row, "head_timestamp", true),
  };
}

interface EventStorageValues extends Readonly<Record<string, null | number | string>> {
  readonly event_id: string;
  readonly kind: "deposit" | "viewing_key_set";
  readonly block_number: number;
  readonly block_hash: string;
  readonly timestamp: number;
  readonly transaction_hash: string;
  readonly event_ordinal: number;
  readonly event_selector: string;
  readonly source_address: string;
  readonly raw_key_count: number;
  readonly raw_data_count: number;
  readonly raw_public_json: string;
  readonly depositor: string | null;
  readonly token: string | null;
  readonly amount_decimal: string | null;
  readonly account: string | null;
}

function eventStorageValues(event: IndexedPoolEvent): EventStorageValues {
  if (event.normalized.kind === "deposit") {
    const observation = event.normalized.observation;
    return {
      event_id: observation.eventId,
      kind: "deposit",
      block_number: observation.blockNumber,
      block_hash: observation.blockHash,
      timestamp: observation.timestamp,
      transaction_hash: observation.transactionHash,
      event_ordinal: observation.eventIndex,
      event_selector: observation.eventSelector,
      source_address: event.raw.from_address,
      raw_key_count: event.raw.keys.length,
      raw_data_count: event.raw.data.length,
      raw_public_json: event.rawPublicJson,
      depositor: observation.depositor,
      token: observation.token,
      amount_decimal: observation.amount.toString(10),
      account: null,
    };
  }
  const observation = event.normalized.observation;
  return {
    event_id: observation.eventId,
    kind: "viewing_key_set",
    block_number: observation.blockNumber,
    block_hash: observation.blockHash,
    timestamp: observation.timestamp,
    transaction_hash: observation.transactionHash,
    event_ordinal: observation.eventIndex,
    event_selector: observation.eventSelector,
    source_address: event.raw.from_address,
    raw_key_count: event.raw.keys.length,
    raw_data_count: event.raw.data.length,
    raw_public_json: event.rawPublicJson,
    depositor: null,
    token: null,
    amount_decimal: null,
    account: observation.account,
  };
}

export interface CanonicalStoreOptions {
  readonly path: string;
  readonly config: StarknetSpikeConfig;
  readonly abi: ReviewedPoolAbi;
  readonly now?: () => number;
  readonly readOnly?: boolean;
}

export class CanonicalStore {
  readonly path: string;
  readonly database: DatabaseSync;
  readonly config: StarknetSpikeConfig;
  readonly abi: ReviewedPoolAbi;
  readonly now: () => number;
  readonly readOnly: boolean;

  constructor(options: CanonicalStoreOptions) {
    this.path = options.path === ":memory:" ? options.path : resolve(options.path);
    this.config = options.config;
    this.abi = options.abi;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.readOnly = options.readOnly ?? false;
    if (this.path !== ":memory:" && !this.readOnly) mkdirSync(dirname(this.path), { recursive: true });
    this.database = new DatabaseSync(this.path, {
      timeout: 5_000,
      readOnly: this.readOnly,
    });
    if (this.readOnly) {
      this.database.exec("PRAGMA query_only = ON; PRAGMA foreign_keys = ON;");
      this.verifySchema();
    } else {
      this.database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;");
      this.migrate();
    }
    this.ensureIdentity();
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS indexer_state (
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
        last_error_at INTEGER,
        last_successful_sync_at INTEGER,
        last_successful_block INTEGER,
        last_sync_duration_ms INTEGER,
        last_batch_duration_ms INTEGER,
        last_snapshot_duration_ms INTEGER,
        rpc_failure_count INTEGER NOT NULL DEFAULT 0,
        rpc_failover_count INTEGER NOT NULL DEFAULT 0,
        active_rpc_provider TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS canonical_blocks (
        block_number INTEGER PRIMARY KEY,
        block_hash TEXT NOT NULL UNIQUE,
        parent_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL,
        retained_reason TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS public_events (
        event_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('deposit', 'viewing_key_set')),
        block_number INTEGER NOT NULL,
        block_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        transaction_hash TEXT NOT NULL,
        event_ordinal INTEGER NOT NULL,
        event_selector TEXT NOT NULL,
        source_address TEXT NOT NULL,
        raw_key_count INTEGER NOT NULL,
        raw_data_count INTEGER NOT NULL,
        raw_public_json TEXT NOT NULL,
        depositor TEXT,
        token TEXT,
        amount_decimal TEXT,
        account TEXT,
        FOREIGN KEY (block_number) REFERENCES canonical_blocks(block_number) ON DELETE CASCADE,
        UNIQUE (block_number, transaction_hash, event_ordinal)
      );

      CREATE INDEX IF NOT EXISTS public_events_time_idx
        ON public_events(timestamp, block_number);
      CREATE INDEX IF NOT EXISTS public_events_token_amount_idx
        ON public_events(token, amount_decimal, timestamp);
      CREATE INDEX IF NOT EXISTS public_events_account_time_idx
        ON public_events(account, timestamp);

      CREATE TABLE IF NOT EXISTS ingestion_batches (
        batch_id TEXT PRIMARY KEY,
        from_block INTEGER NOT NULL,
        through_block INTEGER NOT NULL,
        from_hash TEXT NOT NULL,
        through_hash TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        event_pages INTEGER NOT NULL,
        committed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        snapshot_hash TEXT PRIMARY KEY,
        observed_block INTEGER NOT NULL,
        observed_hash TEXT NOT NULL,
        canonical_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rpc_provider_state (
        provider TEXT PRIMARY KEY CHECK (provider IN ('primary', 'secondary')),
        status TEXT NOT NULL CHECK (status IN ('HEALTHY', 'DEGRADED', 'UNAVAILABLE')),
        last_checked_at INTEGER,
        last_success_at INTEGER,
        last_error_code TEXT,
        chain_id TEXT,
        head_block INTEGER,
        head_hash TEXT,
        head_timestamp INTEGER
      );
    `);
    const version = this.database.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get();
    if (version === undefined) {
      this.database.prepare("INSERT INTO schema_meta(key, value) VALUES('schema_version', ?)").run(
        String(SCHEMA_VERSION),
      );
    } else if (version.value === "1") {
      this.database.exec(`
        ALTER TABLE indexer_state ADD COLUMN last_error_at INTEGER;
        ALTER TABLE indexer_state ADD COLUMN last_successful_sync_at INTEGER;
        ALTER TABLE indexer_state ADD COLUMN last_successful_block INTEGER;
        ALTER TABLE indexer_state ADD COLUMN last_sync_duration_ms INTEGER;
        ALTER TABLE indexer_state ADD COLUMN last_batch_duration_ms INTEGER;
        ALTER TABLE indexer_state ADD COLUMN last_snapshot_duration_ms INTEGER;
        ALTER TABLE indexer_state ADD COLUMN rpc_failure_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE indexer_state ADD COLUMN rpc_failover_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE indexer_state ADD COLUMN active_rpc_provider TEXT;
      `);
      this.database.prepare("UPDATE schema_meta SET value = ? WHERE key = 'schema_version'").run(
        String(SCHEMA_VERSION),
      );
    } else if (version.value !== String(SCHEMA_VERSION)) {
      throw new DataLayerError("INDEX_CORRUPT", "Unsupported index database schema version.");
    }
  }

  private verifySchema(): void {
    const version = this.database.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get();
    if (version === undefined || version.value !== String(SCHEMA_VERSION)) {
      throw new DataLayerError("INDEX_CORRUPT", "Read-only index database schema is unavailable or stale.");
    }
    const state = this.database.prepare("SELECT singleton FROM indexer_state WHERE singleton = 1").get();
    if (state === undefined) {
      throw new DataLayerError("INDEX_CORRUPT", "Read-only index database state is missing.");
    }
  }

  private ensureIdentity(): void {
    const existing = this.database.prepare("SELECT * FROM indexer_state WHERE singleton = 1").get();
    if (existing === undefined) {
      if (this.readOnly) {
        throw new DataLayerError("SNAPSHOT_UNAVAILABLE", "Read-only index database has no initialized state.");
      }
      this.database.prepare(`
        INSERT INTO indexer_state(
          singleton, status, chain_id, pool_address, pool_class_hash,
          abi_fixture_version, updated_at
        ) VALUES(1, 'EMPTY', ?, ?, ?, ?, ?)
      `).run(
        this.config.chainId,
        this.config.poolAddress,
        this.abi.classHash,
        this.abi.fixtureVersion,
        this.now(),
      );
      return;
    }
    const state = stateFromRow(existing);
    if (state.chainId !== this.config.chainId) {
      throw new DataLayerError("INDEX_CORRUPT", "Index database belongs to another Starknet chain.");
    }
    if (state.poolAddress !== this.config.poolAddress) {
      throw new DataLayerError("UNKNOWN_POOL", "Index database belongs to another STRK20 pool.");
    }
    if (
      state.poolClassHash !== this.abi.classHash ||
      state.poolAbiFixtureVersion !== this.abi.fixtureVersion
    ) {
      throw new DataLayerError("POOL_SCHEMA_MISMATCH", "Index database ABI identity is stale.");
    }
  }

  getState(): IndexerState {
    const row = this.database.prepare("SELECT * FROM indexer_state WHERE singleton = 1").get();
    if (row === undefined) throw new DataLayerError("INDEX_CORRUPT", "Indexer state is missing.");
    return stateFromRow(row);
  }

  setStatus(status: IndexerStatus, errorCode: string | null = null): void {
    const retainActiveSnapshot =
      status === "COMPLETE" ||
      status === "SYNCING" ||
      (status === "ERROR" && isTransientSnapshotAvailabilityError(errorCode));
    if (errorCode === null) {
      this.database.prepare(`
        UPDATE indexer_state
        SET status = ?,
            active_snapshot_hash = CASE WHEN ? THEN active_snapshot_hash ELSE NULL END,
            updated_at = ?
        WHERE singleton = 1
      `).run(status, retainActiveSnapshot ? 1 : 0, this.now());
      return;
    }
    const now = this.now();
    this.database.prepare(`
      UPDATE indexer_state
      SET status = ?, last_error_code = ?, last_error_at = ?,
          active_snapshot_hash = CASE WHEN ? THEN active_snapshot_hash ELSE NULL END,
          updated_at = ?
      WHERE singleton = 1
    `).run(status, errorCode, now, retainActiveSnapshot ? 1 : 0, now);
  }

  recordRpcProviderState(state: RpcProviderState): void {
    this.database.prepare(`
      INSERT INTO rpc_provider_state(
        provider, status, last_checked_at, last_success_at, last_error_code,
        chain_id, head_block, head_hash, head_timestamp
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        status = excluded.status,
        last_checked_at = excluded.last_checked_at,
        last_success_at = excluded.last_success_at,
        last_error_code = excluded.last_error_code,
        chain_id = excluded.chain_id,
        head_block = excluded.head_block,
        head_hash = excluded.head_hash,
        head_timestamp = excluded.head_timestamp
    `).run(
      state.provider,
      state.status,
      state.lastCheckedAt,
      state.lastSuccessAt,
      state.lastErrorCode,
      state.chainId,
      state.headBlock,
      state.headHash,
      state.headTimestamp,
    );
  }

  getRpcProviderStates(): readonly RpcProviderState[] {
    return this.database.prepare(`
      SELECT * FROM rpc_provider_state
      ORDER BY CASE provider WHEN 'primary' THEN 0 ELSE 1 END
    `).all().map(providerStateFromRow);
  }

  recordRpcFailure(): void {
    this.database.prepare(`
      UPDATE indexer_state
      SET rpc_failure_count = rpc_failure_count + 1, updated_at = ?
      WHERE singleton = 1
    `).run(this.now());
  }

  recordRpcFailover(): void {
    this.database.prepare(`
      UPDATE indexer_state
      SET rpc_failover_count = rpc_failover_count + 1, updated_at = ?
      WHERE singleton = 1
    `).run(this.now());
  }

  recordSyncSuccess(input: {
    readonly blockNumber: number;
    readonly provider: RpcProviderName | null;
    readonly syncDurationMs: number;
    readonly batchDurationMs: number | null;
    readonly snapshotDurationMs: number;
  }): void {
    const now = this.now();
    this.database.prepare(`
      UPDATE indexer_state
      SET last_successful_sync_at = ?, last_successful_block = ?,
          last_sync_duration_ms = ?, last_batch_duration_ms = ?,
          last_snapshot_duration_ms = ?, active_rpc_provider = ?, updated_at = ?
      WHERE singleton = 1
    `).run(
      now,
      input.blockNumber,
      Math.round(input.syncDurationMs),
      input.batchDurationMs === null ? null : Math.round(input.batchDurationMs),
      Math.round(input.snapshotDurationMs),
      input.provider,
      now,
    );
  }

  initializeSource(input: {
    readonly blockNumber: number;
    readonly blockHash: string;
    readonly timestamp: number;
    readonly requiredFromTimestamp: number;
  }): void {
    this.database.prepare(`
      UPDATE indexer_state
      SET source_from_block = ?, source_from_hash = ?, source_from_timestamp = ?,
          required_from_timestamp = ?, updated_at = ?
      WHERE singleton = 1
    `).run(
      input.blockNumber,
      normalizeFelt(input.blockHash, "source block hash"),
      input.timestamp,
      input.requiredFromTimestamp,
      this.now(),
    );
  }

  private upsertHeader(
    header: {
      readonly blockNumber: number;
      readonly blockHash: string;
      readonly parentHash: string;
      readonly timestamp: number;
      readonly status: string;
    },
    reason: string,
  ): void {
    const blockHash = normalizeFelt(header.blockHash, "block hash");
    const parentHash = normalizeFelt(header.parentHash, "parent hash");
    const existing = this.database
      .prepare("SELECT block_hash, parent_hash, timestamp FROM canonical_blocks WHERE block_number = ?")
      .get(header.blockNumber);
    if (existing !== undefined) {
      if (
        text(existing, "block_hash") !== blockHash ||
        text(existing, "parent_hash") !== parentHash ||
        integer(existing, "timestamp") !== header.timestamp
      ) {
        throw new DataLayerError(
          "INCONSISTENT_BLOCK_DATA",
          `Canonical block ${header.blockNumber} disagrees with persisted provenance.`,
        );
      }
      return;
    }
    this.database.prepare(`
      INSERT INTO canonical_blocks(
        block_number, block_hash, parent_hash, timestamp, status, retained_reason
      ) VALUES(?, ?, ?, ?, ?, ?)
    `).run(
      header.blockNumber,
      blockHash,
      parentHash,
      header.timestamp,
      header.status,
      reason,
    );
  }

  private insertEvent(event: IndexedPoolEvent): void {
    const values = eventStorageValues(event);
    const existing = this.database.prepare("SELECT * FROM public_events WHERE event_id = ?").get(
      values.event_id,
    );
    if (existing !== undefined) {
      const comparable = {
        kind: text(existing, "kind"),
        blockNumber: integer(existing, "block_number"),
        blockHash: text(existing, "block_hash"),
        timestamp: integer(existing, "timestamp"),
        transactionHash: text(existing, "transaction_hash"),
        eventOrdinal: integer(existing, "event_ordinal"),
        eventSelector: text(existing, "event_selector"),
        rawPublicJson: text(existing, "raw_public_json"),
      };
      const incoming = {
        kind: values.kind,
        blockNumber: values.block_number,
        blockHash: values.block_hash,
        timestamp: values.timestamp,
        transactionHash: values.transaction_hash,
        eventOrdinal: values.event_ordinal,
        eventSelector: values.event_selector,
        rawPublicJson: values.raw_public_json,
      };
      if (JSON.stringify(comparable) !== JSON.stringify(incoming)) {
        throw new DataLayerError("INDEX_CORRUPT", `Event identity ${values.event_id} changed.`);
      }
      return;
    }
    this.database.prepare(`
      INSERT INTO public_events(
        event_id, kind, block_number, block_hash, timestamp, transaction_hash,
        event_ordinal, event_selector, source_address, raw_key_count,
        raw_data_count, raw_public_json, depositor, token, amount_decimal, account
      ) VALUES(
        $event_id, $kind, $block_number, $block_hash, $timestamp, $transaction_hash,
        $event_ordinal, $event_selector, $source_address, $raw_key_count,
        $raw_data_count, $raw_public_json, $depositor, $token, $amount_decimal, $account
      )
    `).run(values);
  }

  commitBatch(batch: IndexBatch): void {
    transaction(this.database, () => {
      for (const header of batch.headers) this.upsertHeader(header, "batch");
      for (const event of batch.events) this.insertEvent(event);
      this.database.prepare(`
        INSERT OR IGNORE INTO ingestion_batches(
          batch_id, from_block, through_block, from_hash, through_hash,
          event_count, event_pages, committed_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        batchId(batch),
        batch.fromBlock,
        batch.throughBlock,
        batch.fromHeader.blockHash,
        batch.throughHeader.blockHash,
        batch.events.length,
        batch.eventPages,
        this.now(),
      );
      this.database.prepare(`
        UPDATE indexer_state
        SET status = 'SYNCING', indexed_through_block = ?, indexed_through_hash = ?,
            indexed_through_timestamp = ?,
            updated_at = ?
        WHERE singleton = 1
      `).run(
        batch.throughBlock,
        batch.throughHeader.blockHash,
        batch.throughHeader.timestamp,
        this.now(),
      );
    });
  }

  retainHeaders(
    headers: readonly {
      readonly blockNumber: number;
      readonly blockHash: string;
      readonly parentHash: string;
      readonly timestamp: number;
      readonly status: string;
    }[],
    reason: string,
  ): void {
    transaction(this.database, () => {
      for (const header of headers) this.upsertHeader(header, reason);
    });
  }

  recentHeadersDescending(maximum: number): readonly BlockReference[] {
    return this.database
      .prepare(`
        SELECT block_number, block_hash, parent_hash, timestamp
        FROM canonical_blocks
        ORDER BY block_number DESC
        LIMIT ?
      `)
      .all(maximum)
      .map((row) => ({
        blockNumber: integer(row, "block_number") as number,
        blockHash: text(row, "block_hash") as string,
        parentHash: text(row, "parent_hash") as string,
        timestamp: integer(row, "timestamp") as number,
      }));
  }

  getHeader(blockNumber: number): BlockReference | undefined {
    const row = this.database.prepare(`
      SELECT block_number, block_hash, parent_hash, timestamp
      FROM canonical_blocks WHERE block_number = ?
    `).get(blockNumber);
    if (row === undefined) return undefined;
    return {
      blockNumber: integer(row, "block_number") as number,
      blockHash: text(row, "block_hash") as string,
      parentHash: text(row, "parent_hash") as string,
      timestamp: integer(row, "timestamp") as number,
    };
  }

  rollbackTo(blockNumber: number): void {
    transaction(this.database, () => {
      const header = this.getHeader(blockNumber);
      if (header === undefined) {
        throw new DataLayerError("INDEX_CORRUPT", "Rollback ancestor is not retained.");
      }
      this.database.prepare("DELETE FROM snapshots WHERE observed_block > ?").run(blockNumber);
      this.database.prepare("DELETE FROM ingestion_batches WHERE through_block > ?").run(blockNumber);
      this.database.prepare("DELETE FROM canonical_blocks WHERE block_number > ?").run(blockNumber);
      this.database.prepare(`
        UPDATE indexer_state
        SET status = 'SYNCING', indexed_through_block = ?, indexed_through_hash = ?,
            indexed_through_timestamp = ?, active_snapshot_hash = NULL,
            updated_at = ?
        WHERE singleton = 1
      `).run(blockNumber, header.blockHash, header.timestamp, this.now());
    });
  }

  resetForReplay(): void {
    transaction(this.database, () => {
      this.database.exec(`
        DELETE FROM snapshots;
        DELETE FROM ingestion_batches;
        DELETE FROM public_events;
        DELETE FROM canonical_blocks;
      `);
      this.database.prepare(`
        UPDATE indexer_state
        SET status = 'EMPTY', source_from_block = NULL, source_from_hash = NULL,
            source_from_timestamp = NULL, required_from_timestamp = NULL,
            indexed_through_block = NULL, indexed_through_hash = NULL,
            indexed_through_timestamp = NULL, active_snapshot_hash = NULL,
            updated_at = ?
        WHERE singleton = 1
      `).run(this.now());
    });
  }

  private observationRows(): readonly SqlRow[] {
    return this.database.prepare("SELECT * FROM public_events").all();
  }

  loadObservations(): {
    readonly deposits: readonly PublicDepositObservation[];
    readonly registrations: readonly PublicRegistrationObservation[];
  } {
    const deposits: PublicDepositObservation[] = [];
    const registrations: PublicRegistrationObservation[] = [];
    for (const row of this.observationRows()) {
      const base = {
        blockNumber: integer(row, "block_number") as number,
        blockHash: normalizeFelt(text(row, "block_hash"), "stored event block hash"),
        timestamp: integer(row, "timestamp") as number,
        transactionHash: normalizeTransactionHash(text(row, "transaction_hash")),
        eventIndex: integer(row, "event_ordinal") as number,
        eventId: text(row, "event_id") as string,
        eventSelector: normalizeFelt(text(row, "event_selector"), "stored selector"),
      };
      if (text(row, "kind") === "deposit") {
        const depositor = normalizeAddress(text(row, "depositor"), "stored depositor");
        const token = normalizeAddress(text(row, "token"), "stored token");
        const amountText = text(row, "amount_decimal");
        let amount: bigint;
        try {
          amount = BigInt(amountText);
        } catch {
          throw new DataLayerError("INDEX_CORRUPT", "Stored deposit amount is invalid.");
        }
        deposits.push({
          ...base,
          depositor,
          token,
          amount,
          normalizedFields: { depositor, token, amount: amount.toString(10) },
        });
      } else {
        const account = normalizeAddress(text(row, "account"), "stored registration account");
        registrations.push({
          ...base,
          account,
          normalizedFields: { account },
        });
      }
    }
    return { deposits, registrations };
  }

  blockReferencesForSnapshot(extra: readonly BlockReference[]): readonly BlockReference[] {
    const rows = this.database.prepare(`
      SELECT DISTINCT b.block_number, b.block_hash, b.parent_hash, b.timestamp
      FROM canonical_blocks b
      LEFT JOIN public_events e ON e.block_number = b.block_number
      WHERE e.event_id IS NOT NULL
         OR b.block_number IN (
           SELECT source_from_block FROM indexer_state WHERE singleton = 1
         )
         OR b.block_number IN (
           SELECT indexed_through_block FROM indexer_state WHERE singleton = 1
         )
         OR b.block_number IN (
           SELECT indexed_through_block - 1 FROM indexer_state WHERE singleton = 1
         )
    `).all();
    const merged = new Map<number, BlockReference>();
    for (const row of rows) {
      merged.set(integer(row, "block_number") as number, {
        blockNumber: integer(row, "block_number") as number,
        blockHash: text(row, "block_hash") as string,
        parentHash: text(row, "parent_hash") as string,
        timestamp: integer(row, "timestamp") as number,
      });
    }
    for (const reference of extra) {
      const existing = merged.get(reference.blockNumber);
      if (
        existing !== undefined &&
        (existing.blockHash !== reference.blockHash ||
          existing.parentHash !== reference.parentHash ||
          existing.timestamp !== reference.timestamp)
      ) {
        throw new DataLayerError(
          "INCONSISTENT_BLOCK_DATA",
          `Snapshot reference ${reference.blockNumber} disagrees with the index.`,
        );
      }
      merged.set(reference.blockNumber, reference);
    }
    return [...merged.values()];
  }

  persistCompleteSnapshot(snapshot: PublicSnapshot): SnapshotHash {
    const snapshotHash = hashPublicSnapshot(snapshot);
    const canonicalJson = canonicalSnapshotJson(snapshot);
    transaction(this.database, () => {
      this.database.prepare(`
        INSERT OR REPLACE INTO snapshots(
          snapshot_hash, observed_block, observed_hash, canonical_json, created_at
        ) VALUES(?, ?, ?, ?, ?)
      `).run(
        snapshotHash,
        snapshot.observedBlock,
        snapshot.observedBlockHash,
        canonicalJson,
        this.now(),
      );
      this.database.prepare(`
        UPDATE indexer_state
        SET status = 'COMPLETE', active_snapshot_hash = ?, updated_at = ?
        WHERE singleton = 1
      `).run(snapshotHash, this.now());
      this.database.prepare(`
        DELETE FROM snapshots
        WHERE snapshot_hash <> ?
          AND snapshot_hash NOT IN (
            SELECT snapshot_hash
            FROM snapshots
            WHERE snapshot_hash <> ?
            ORDER BY created_at DESC, observed_block DESC, snapshot_hash DESC
            LIMIT ?
          )
      `).run(snapshotHash, snapshotHash, MAX_SNAPSHOT_HISTORY - 1);
    });
    return snapshotHash;
  }

  loadCompleteSnapshot(): PublicSnapshot {
    return readTransaction(this.database, () => this.loadCompleteSnapshotRow());
  }

  /**
   * Returns the most recently persisted, hash-valid snapshot even when the
   * indexer has deliberately withdrawn it from serving during recovery.
   * Preflight never calls this method; it exists for operational durability
   * reporting and backup/recovery tooling.
   */
  loadLatestPersistedSnapshot(): PublicSnapshot | null {
    return readTransaction(this.database, () => {
      const row = this.database.prepare(`
        SELECT snapshot_hash, canonical_json
        FROM snapshots
        ORDER BY created_at DESC, observed_block DESC, snapshot_hash DESC
        LIMIT 1
      `).get();
      if (row === undefined) return null;
      const snapshotHash = text(row, "snapshot_hash");
      const snapshot = this.parseSnapshotJson(text(row, "canonical_json"));
      if (hashPublicSnapshot(snapshot) !== snapshotHash) {
        throw new DataLayerError("INDEX_CORRUPT", "Latest persisted snapshot hash is invalid.");
      }
      return snapshot;
    });
  }

  private loadCompleteSnapshotRow(): PublicSnapshot {
    const state = this.getState();
    const activeSnapshotIsUsable =
      state.activeSnapshotHash !== null &&
      (state.status === "COMPLETE" ||
        state.status === "SYNCING" ||
        (state.status === "ERROR" &&
          isTransientSnapshotAvailabilityError(state.lastErrorCode)));
    if (!activeSnapshotIsUsable) {
      if (state.status === "ERROR") {
        if (isDataLayerErrorCode(state.lastErrorCode)) {
          throw new DataLayerError(
            state.lastErrorCode,
            `Indexer is unavailable after ${state.lastErrorCode}.`,
          );
        }
        if (state.lastErrorCode !== null) {
          throw new DataLayerError("INDEX_CORRUPT", "Indexer persisted an unknown failure code.");
        }
      }
      throw new DataLayerError("SNAPSHOT_UNAVAILABLE", "No complete canonical snapshot is available.");
    }
    const row = this.database
      .prepare("SELECT canonical_json FROM snapshots WHERE snapshot_hash = ?")
      .get(state.activeSnapshotHash);
    if (row === undefined) {
      throw new DataLayerError("INDEX_CORRUPT", "Active snapshot row is missing.");
    }
    const snapshot = this.parseSnapshotJson(text(row, "canonical_json"));
    if (hashPublicSnapshot(snapshot) !== state.activeSnapshotHash) {
      throw new DataLayerError("INDEX_CORRUPT", "Stored snapshot hash does not match its contents.");
    }
    return snapshot;
  }

  private parseSnapshotJson(json: string): PublicSnapshot {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new DataLayerError("INDEX_CORRUPT", "Stored snapshot JSON is invalid.");
    }
    if (parsed === null || typeof parsed !== "object") {
      throw new DataLayerError("INDEX_CORRUPT", "Stored snapshot has an invalid shape.");
    }
    const candidate = parsed as Omit<PublicSnapshot, "depositObservations"> & {
      depositObservations: Array<Omit<PublicDepositObservation, "amount"> & { amount: string }>;
    };
    let snapshot: PublicSnapshot;
    try {
      snapshot = {
        ...candidate,
        depositObservations: candidate.depositObservations.map((observation) => ({
          ...observation,
          amount: BigInt(observation.amount),
        })),
      };
    } catch {
      throw new DataLayerError("INDEX_CORRUPT", "Stored snapshot amounts are invalid.");
    }
    return snapshot;
  }

  /**
   * Runs a deep SQLite integrity scan for operator/backup verification.
   * Request-time health checks intentionally do not call this over the live DB.
   */
  databaseIntegrity(): "ok" | "error" {
    try {
      const row = this.database.prepare("PRAGMA quick_check").get();
      return row !== undefined && text(row as SqlRow, "quick_check") === "ok" ? "ok" : "error";
    } catch {
      return "error";
    }
  }

  async backupTo(destinationPath: string): Promise<number> {
    return sqliteBackup(this.database, resolve(destinationPath));
  }

  counts(): { readonly blocks: number; readonly events: number; readonly batches: number } {
    const count = (table: string): number => {
      const row = this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
      return integer(row as SqlRow, "count") as number;
    };
    return {
      blocks: count("canonical_blocks"),
      events: count("public_events"),
      batches: count("ingestion_batches"),
    };
  }
}
