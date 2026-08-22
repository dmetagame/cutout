import { CUTOUT_MODEL, CUTOUT_MODEL_V1_4 } from "../engine/constants.js";
import { performance } from "node:perf_hooks";
import type { Address } from "../engine/types.js";
import type { ReviewedPoolAbi } from "../starknet/abi.js";
import type { StarknetSpikeConfig } from "../starknet/config.js";
import { decodePoolEvent } from "../starknet/events.js";
import { normalizeAddress, normalizeFelt, normalizeTransactionHash } from "../starknet/felt.js";
import { validatePublicSnapshot } from "../starknet/freshness.js";
import { FRESHNESS_POLICY } from "../starknet/policies.js";
import type {
  PublicRpc,
  RpcBlockHeader,
  RpcEvent,
  RpcEventFilter,
} from "../starknet/rpc.js";
import type { BlockReference, PublicSnapshot, SpikeShieldIntent } from "../starknet/types.js";
import { asDataLayerError, DataLayerError } from "./errors.js";
import { CanonicalStore } from "./store.js";
import type {
  IndexBatch,
  IndexedPoolEvent,
  IndexerOptions,
  IndexerSyncResult,
  ReorgResult,
} from "./types.js";

const DEFAULT_MAX_RANGE_BLOCKS = 50_000;
const DEFAULT_REORG_WINDOW_BLOCKS = 2_048;

interface CollectedRawEvent {
  readonly raw: RpcEvent;
  readonly sourceOrdinal: number;
  readonly fingerprint: string;
}

function asReference(header: RpcBlockHeader): BlockReference {
  return {
    blockNumber: header.blockNumber,
    blockHash: header.blockHash,
    parentHash: header.parentHash,
    timestamp: header.timestamp,
  };
}

function canonicalRawEvent(raw: RpcEvent): {
  readonly blockHash: string;
  readonly blockNumber: number;
  readonly transactionHash: string;
  readonly fromAddress: string;
  readonly keys: readonly string[];
  readonly data: readonly string[];
} {
  return {
    blockHash: normalizeFelt(raw.block_hash, "event block hash"),
    blockNumber: raw.block_number,
    transactionHash: normalizeTransactionHash(raw.transaction_hash),
    fromAddress: normalizeAddress(raw.from_address, "event source"),
    keys: raw.keys.map((item) => normalizeFelt(item, "event key")),
    data: raw.data.map((item) => normalizeFelt(item, "event data")),
  };
}

function rawFingerprint(raw: RpcEvent): string {
  return JSON.stringify(canonicalRawEvent(raw));
}

function rawOrder(left: CollectedRawEvent, right: CollectedRawEvent): number {
  if (left.raw.block_number !== right.raw.block_number) {
    return left.raw.block_number - right.raw.block_number;
  }
  const transactionOrder = normalizeTransactionHash(left.raw.transaction_hash).localeCompare(
    normalizeTransactionHash(right.raw.transaction_hash),
  );
  if (transactionOrder !== 0) return transactionOrder;
  const fingerprintOrder = left.fingerprint.localeCompare(right.fingerprint);
  if (fingerprintOrder !== 0) return fingerprintOrder;
  return left.sourceOrdinal - right.sourceOrdinal;
}

function rawPublicJson(
  raw: RpcEvent,
  kind: "deposit" | "withdrawal" | "viewing-key-registration",
): string {
  const canonical = canonicalRawEvent(raw);
  if (kind === "deposit") return JSON.stringify(canonical);
  if (kind === "withdrawal") {
    return JSON.stringify({
      blockHash: canonical.blockHash,
      blockNumber: canonical.blockNumber,
      transactionHash: canonical.transactionHash,
      fromAddress: canonical.fromAddress,
      selector: canonical.keys[0],
      recipient: canonical.keys[1],
      token: canonical.keys[2],
      amount: canonical.data[3],
      keyCount: canonical.keys.length,
      dataCount: canonical.data.length,
    });
  }
  return JSON.stringify({
    blockHash: canonical.blockHash,
    blockNumber: canonical.blockNumber,
    transactionHash: canonical.transactionHash,
    fromAddress: canonical.fromAddress,
    selector: canonical.keys[0],
    account: canonical.keys[1],
    keyCount: canonical.keys.length,
    dataCount: canonical.data.length,
  });
}

function uniqueHeaders(headers: readonly RpcBlockHeader[]): readonly RpcBlockHeader[] {
  const byNumber = new Map<number, RpcBlockHeader>();
  for (const header of headers) {
    const existing = byNumber.get(header.blockNumber);
    if (
      existing !== undefined &&
      (existing.blockHash !== header.blockHash ||
        existing.parentHash !== header.parentHash ||
        existing.timestamp !== header.timestamp)
    ) {
      throw new DataLayerError(
        "INCONSISTENT_BLOCK_DATA",
        `RPC returned conflicting headers for block ${header.blockNumber}.`,
      );
    }
    byNumber.set(header.blockNumber, header);
  }
  return [...byNumber.values()].sort((left, right) => left.blockNumber - right.blockNumber);
}

async function findBlockAtOrBeforeTimestamp(
  rpc: PublicRpc,
  firstBlock: number,
  lastBlock: number,
  targetTimestamp: number,
): Promise<RpcBlockHeader> {
  const cache = new Map<number, RpcBlockHeader>();
  const get = async (blockNumber: number): Promise<RpcBlockHeader> => {
    const cached = cache.get(blockNumber);
    if (cached !== undefined) return cached;
    const header = await rpc.getBlock(blockNumber);
    cache.set(blockNumber, header);
    return header;
  };
  const first = await get(firstBlock);
  if (targetTimestamp <= first.timestamp) return first;
  let low = firstBlock;
  let high = lastBlock;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const header = await get(middle);
    if (header.timestamp <= targetTimestamp) low = middle;
    else high = middle - 1;
  }
  return get(low);
}

export class IncrementalPublicIndexer {
  readonly rpc: PublicRpc;
  readonly store: CanonicalStore;
  readonly config: StarknetSpikeConfig;
  readonly abi: ReviewedPoolAbi;
  readonly maxRangeBlocks: number;
  readonly reorgWindowBlocks: number;
  readonly rpcProviderName: IndexerOptions["rpcProviderName"];
  readonly modelVersion: "CUTOUT-v1.3" | "CUTOUT-v1.4";
  readonly now: () => number;
  readonly onProgress: ((message: string) => void) | undefined;

  constructor(rpc: PublicRpc, store: CanonicalStore, options: IndexerOptions) {
    this.rpc = rpc;
    this.store = store;
    this.config = options.config;
    this.abi = options.abi;
    this.maxRangeBlocks = Math.min(
      options.maxRangeBlocks ?? DEFAULT_MAX_RANGE_BLOCKS,
      this.config.maxEventRangeBlocks,
    );
    this.reorgWindowBlocks = options.reorgWindowBlocks ?? DEFAULT_REORG_WINDOW_BLOCKS;
    this.rpcProviderName = options.rpcProviderName;
    this.modelVersion = options.modelVersion ?? CUTOUT_MODEL.version;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.onProgress = options.onProgress;
    if (!Number.isSafeInteger(this.maxRangeBlocks) || this.maxRangeBlocks <= 0) {
      throw new DataLayerError("INDEX_CORRUPT", "Indexer range size must be positive.");
    }
    if (!Number.isSafeInteger(this.reorgWindowBlocks) || this.reorgWindowBlocks < 2) {
      throw new DataLayerError("INDEX_CORRUPT", "Reorg window must retain at least two blocks.");
    }
  }

  private progress(message: string): void {
    this.onProgress?.(message);
  }

  private async assertRpcIdentity(blockNumber: number): Promise<void> {
    const chainId = normalizeFelt(await this.rpc.getChainId(), "RPC chain id");
    if (chainId !== this.config.chainId) {
      throw new DataLayerError("INCONSISTENT_BLOCK_DATA", "RPC is connected to another chain.");
    }
    const classHash = normalizeFelt(
      await this.rpc.getClassHashAt(blockNumber, this.config.poolAddress),
      "pool class hash",
    );
    if (classHash !== this.abi.classHash) {
      throw new DataLayerError(
        "POOL_SCHEMA_MISMATCH",
        "STRK20 pool class hash differs from the reviewed ABI fixture.",
      );
    }
  }

  private async collectRangeEvents(
    fromBlock: number,
    throughBlock: number,
  ): Promise<{ readonly events: readonly CollectedRawEvent[]; readonly pages: number }> {
    const events: CollectedRawEvent[] = [];
    const seenTokens = new Set<string>();
    let continuationToken: string | undefined;
    let pages = 0;
    let sourceOrdinal = 0;
    do {
      const base: Omit<RpcEventFilter, "continuation_token"> = {
        from_block: { block_number: fromBlock },
        to_block: { block_number: throughBlock },
        address: this.config.poolAddress,
        keys: [[
          this.abi.deposit.selector,
          ...(this.modelVersion === CUTOUT_MODEL_V1_4.version
            ? [this.abi.withdrawal.selector]
            : []),
          this.abi.viewingKeySet.selector,
        ]],
        chunk_size: 1_000,
      };
      const filter: RpcEventFilter =
        continuationToken === undefined
          ? base
          : { ...base, continuation_token: continuationToken };
      const page = await this.rpc.getEvents(filter);
      pages += 1;
      for (const raw of page.events) {
        events.push({ raw, sourceOrdinal, fingerprint: rawFingerprint(raw) });
        sourceOrdinal += 1;
      }
      continuationToken = page.continuationToken;
      if (continuationToken !== undefined) {
        if (seenTokens.has(continuationToken)) {
          throw new DataLayerError(
            "INDEX_CORRUPT",
            "RPC repeated a continuation token while indexing a complete range.",
          );
        }
        seenTokens.add(continuationToken);
      }
    } while (continuationToken !== undefined);
    return { events: events.sort(rawOrder), pages };
  }

  private async buildBatch(
    fromBlock: number,
    throughBlock: number,
    priorHeader: BlockReference | undefined,
  ): Promise<IndexBatch> {
    await this.assertRpcIdentity(throughBlock);
    const collected = await this.collectRangeEvents(fromBlock, throughBlock);
    const headerNumbers = new Set<number>([fromBlock, throughBlock]);
    if (throughBlock > 0) headerNumbers.add(throughBlock - 1);
    for (const event of collected.events) headerNumbers.add(event.raw.block_number);
    const headers = uniqueHeaders(await this.rpc.getBlocks([...headerNumbers]));
    const byNumber = new Map(headers.map((header) => [header.blockNumber, header]));
    for (const blockNumber of headerNumbers) {
      if (!byNumber.has(blockNumber)) {
        throw new DataLayerError(
          "INCONSISTENT_BLOCK_DATA",
          `RPC omitted required block header ${blockNumber}.`,
        );
      }
    }
    const fromHeader = byNumber.get(fromBlock) as RpcBlockHeader;
    const throughHeader = byNumber.get(throughBlock) as RpcBlockHeader;
    if (priorHeader !== undefined && fromBlock === priorHeader.blockNumber + 1) {
      if (fromHeader.parentHash !== priorHeader.blockHash) {
        throw new DataLayerError(
          "INCONSISTENT_BLOCK_DATA",
          `Block ${fromBlock} does not extend the indexed cursor.`,
        );
      }
    }
    if (throughBlock > 0) {
      const parent = byNumber.get(throughBlock - 1) as RpcBlockHeader;
      if (throughHeader.parentHash !== parent.blockHash) {
        throw new DataLayerError(
          "INCONSISTENT_BLOCK_DATA",
          `Range head ${throughBlock} has a broken parent link.`,
        );
      }
    }

    const perTransactionOrdinal = new Map<string, number>();
    const events: IndexedPoolEvent[] = [];
    for (const item of collected.events) {
      const header = byNumber.get(item.raw.block_number);
      if (header === undefined) {
        throw new DataLayerError("INCONSISTENT_BLOCK_DATA", "Event block header is missing.");
      }
      const transactionHash = normalizeTransactionHash(item.raw.transaction_hash);
      const transactionKey = `${item.raw.block_number}:${transactionHash}`;
      const eventOrdinal = perTransactionOrdinal.get(transactionKey) ?? 0;
      perTransactionOrdinal.set(transactionKey, eventOrdinal + 1);
      const normalized = decodePoolEvent(
        item.raw,
        eventOrdinal,
        header,
        this.config.poolAddress,
        this.abi,
      );
      events.push({
        raw: item.raw,
        eventOrdinal,
        normalized,
        rawPublicJson: rawPublicJson(item.raw, normalized.kind),
      });
    }

    const revalidated = await this.rpc.getBlock(throughBlock);
    if (
      revalidated.blockHash !== throughHeader.blockHash ||
      revalidated.parentHash !== throughHeader.parentHash ||
      revalidated.timestamp !== throughHeader.timestamp
    ) {
      throw new DataLayerError(
        "INCONSISTENT_BLOCK_DATA",
        `Range head ${throughBlock} changed during ingestion.`,
      );
    }
    return {
      fromBlock,
      throughBlock,
      fromHeader,
      throughHeader: revalidated,
      headers,
      events,
      eventPages: collected.pages,
    };
  }

  private async recoverReorg(): Promise<ReorgResult> {
    const state = this.store.getState();
    if (state.indexedThroughBlock === null || state.indexedThroughHash === null) {
      return { detected: false, rolledBackToBlock: null, fullReplay: false };
    }
    const liveCursor = await this.rpc.getBlock(state.indexedThroughBlock);
    if (liveCursor.blockHash === state.indexedThroughHash) {
      const retainedParent = this.store.getHeader(state.indexedThroughBlock - 1);
      if (retainedParent !== undefined && liveCursor.parentHash !== retainedParent.blockHash) {
        throw new DataLayerError(
          "INCONSISTENT_BLOCK_DATA",
          "Indexed cursor hash matches but its retained parent link does not.",
        );
      }
      return { detected: false, rolledBackToBlock: null, fullReplay: false };
    }

    this.store.setStatus("REORGING");
    const candidates = this.store.recentHeadersDescending(this.reorgWindowBlocks);
    const live = await this.rpc.getBlocks(candidates.map((candidate) => candidate.blockNumber));
    const liveByNumber = new Map(live.map((header) => [header.blockNumber, header]));
    const ancestor = candidates.find(
      (candidate) => liveByNumber.get(candidate.blockNumber)?.blockHash === candidate.blockHash,
    );
    if (ancestor === undefined) {
      this.progress("reorg exceeded retained window; resetting for deterministic replay");
      this.store.resetForReplay();
      return { detected: true, rolledBackToBlock: null, fullReplay: true };
    }
    this.progress(`reorg detected; rolling back to canonical block ${ancestor.blockNumber}`);
    this.store.rollbackTo(ancestor.blockNumber);
    return {
      detected: true,
      rolledBackToBlock: ancestor.blockNumber,
      fullReplay: false,
    };
  }

  private async retainDenseCursorWindow(): Promise<void> {
    const state = this.store.getState();
    if (state.indexedThroughBlock === null || state.sourceFromBlock === null) return;
    const fromBlock = Math.max(
      state.sourceFromBlock,
      state.indexedThroughBlock - this.reorgWindowBlocks + 1,
    );
    const blockNumbers = Array.from(
      { length: state.indexedThroughBlock - fromBlock + 1 },
      (_value, index) => fromBlock + index,
    );
    const headers = uniqueHeaders(await this.rpc.getBlocks(blockNumbers));
    if (headers.length !== blockNumbers.length) {
      throw new DataLayerError(
        "INCONSISTENT_BLOCK_DATA",
        "RPC omitted a block from the retained reorg window.",
      );
    }
    for (let index = 1; index < headers.length; index += 1) {
      const prior = headers[index - 1];
      const current = headers[index];
      if (prior === undefined || current === undefined) continue;
      if (current.parentHash !== prior.blockHash || current.timestamp < prior.timestamp) {
        throw new DataLayerError(
          "INCONSISTENT_BLOCK_DATA",
          `Retained reorg window breaks at block ${current.blockNumber}.`,
        );
      }
    }
    this.store.retainHeaders(headers, "reorg_window");
  }

  private syntheticIntent(snapshot: PublicSnapshot): SpikeShieldIntent {
    const token = this.config.tokens[0]?.address;
    if (token === undefined) {
      throw new DataLayerError("INDEX_CORRUPT", "No supported token is configured.");
    }
    const evaluationTimestamp = this.now();
    return {
      action: "shield",
      chainId: this.config.chainId,
      account: "0x1" as Address,
      token,
      amount: 1n,
      evaluationBlock: snapshot.observedBlock,
      evaluationTimestamp,
      flexibility: { mode: "exact" },
      deadline: evaluationTimestamp + 3_600,
    };
  }

  private async finalizeSnapshot(): Promise<{ readonly snapshot: PublicSnapshot; readonly snapshotHash: `0x${string}` }> {
    const state = this.store.getState();
    if (
      state.sourceFromBlock === null ||
      state.sourceFromHash === null ||
      state.sourceFromTimestamp === null ||
      state.requiredFromTimestamp === null ||
      state.indexedThroughBlock === null ||
      state.indexedThroughHash === null ||
      state.indexedThroughTimestamp === null
    ) {
      throw new DataLayerError("INSUFFICIENT_HISTORY", "Indexer cursor is incomplete.");
    }

    const indexedHeader = await this.rpc.getBlock(state.indexedThroughBlock);
    if (indexedHeader.blockHash !== state.indexedThroughHash) {
      throw new DataLayerError(
        "INCONSISTENT_BLOCK_DATA",
        "Indexed cursor changed before snapshot publication.",
      );
    }
    const indexedParent = await this.rpc.getBlock(state.indexedThroughBlock - 1);
    if (indexedHeader.parentHash !== indexedParent.blockHash) {
      throw new DataLayerError("INCONSISTENT_BLOCK_DATA", "Indexed cursor parent link is broken.");
    }
    const rpcHeadBlock = await this.rpc.getBlockNumber();
    if (rpcHeadBlock < state.indexedThroughBlock) {
      throw new DataLayerError("INCONSISTENT_BLOCK_DATA", "RPC head moved behind the index cursor.");
    }
    const rpcHead = await this.rpc.getBlock(rpcHeadBlock);
    const rpcHeadParent = await this.rpc.getBlock(rpcHeadBlock - 1);
    if (rpcHead.parentHash !== rpcHeadParent.blockHash) {
      throw new DataLayerError("INCONSISTENT_BLOCK_DATA", "RPC head parent link is broken.");
    }
    await this.assertRpcIdentity(rpcHeadBlock);
    this.store.retainHeaders([indexedParent, indexedHeader], "snapshot_boundary");

    const sourceHeader = this.store.getHeader(state.sourceFromBlock);
    if (sourceHeader === undefined || sourceHeader.blockHash !== state.sourceFromHash) {
      throw new DataLayerError("INDEX_CORRUPT", "Source boundary header is unavailable.");
    }
    const observations = this.store.loadObservations();
    const blockReferences = this.store.blockReferencesForSnapshot([
      asReference(indexedParent),
      asReference(indexedHeader),
      asReference(rpcHeadParent),
      asReference(rpcHead),
    ]);
    const snapshot: PublicSnapshot = {
      chainId: this.config.chainId,
      poolAddress: this.config.poolAddress,
      poolClassHash: this.abi.classHash,
      poolAbiFixtureVersion: this.abi.fixtureVersion,
      observedBlock: indexedHeader.blockNumber,
      observedBlockHash: indexedHeader.blockHash,
      observedTimestamp: indexedHeader.timestamp,
      indexedThroughBlock: indexedHeader.blockNumber,
      indexedThroughHash: indexedHeader.blockHash,
      indexedThroughTimestamp: indexedHeader.timestamp,
      rpcHeadBlock: rpcHead.blockNumber,
      rpcHeadHash: rpcHead.blockHash,
      rpcHeadTimestamp: rpcHead.timestamp,
      sourceFromBlock: sourceHeader.blockNumber,
      sourceFromHash: sourceHeader.blockHash,
      sourceFromTimestamp: sourceHeader.timestamp,
      requiredFromTimestamp: state.requiredFromTimestamp,
      sourceComplete: sourceHeader.timestamp <= state.requiredFromTimestamp,
      pagesComplete: true,
      queriedSelectors: this.modelVersion === CUTOUT_MODEL_V1_4.version
        ? [this.abi.deposit.selector, this.abi.withdrawal.selector, this.abi.viewingKeySet.selector]
        : [this.abi.deposit.selector, this.abi.viewingKeySet.selector],
      sourceParentBlock: indexedParent.blockNumber,
      sourceParentHash: indexedParent.blockHash,
      sourceDeclaredParentHash: indexedHeader.parentHash,
      blockReferences,
      depositObservations: observations.deposits,
      ...(this.modelVersion === CUTOUT_MODEL_V1_4.version
        ? { withdrawalObservations: observations.withdrawals }
        : {}),
      viewingKeyRegistrationObservations: observations.registrations,
      engineVersion: this.modelVersion,
      freshnessPolicyVersion: FRESHNESS_POLICY.version,
    };
    validatePublicSnapshot(snapshot, this.syntheticIntent(snapshot), this.config, this.abi);
    return { snapshot, snapshotHash: this.store.persistCompleteSnapshot(snapshot) };
  }

  async syncOnce(requiredFromTimestamp: number): Promise<IndexerSyncResult> {
    if (!Number.isSafeInteger(requiredFromTimestamp) || requiredFromTimestamp < 0) {
      throw new DataLayerError("INSUFFICIENT_HISTORY", "Required history timestamp is invalid.");
    }
    const syncStarted = performance.now();
    let lastBatchDurationMs: number | null = null;
    this.store.ensureModelVersion(this.modelVersion);
    this.store.setStatus("SYNCING");
    let batchesCommitted = 0;
    let eventPages = 0;
    try {
      const initialHead = await this.rpc.getBlockNumber();
      await this.assertRpcIdentity(initialHead);
      const reorg = await this.recoverReorg();
      let state = this.store.getState();
      if (state.sourceFromBlock === null) {
        const sourceHeader = await findBlockAtOrBeforeTimestamp(
          this.rpc,
          this.config.poolDeploymentBlock,
          initialHead,
          requiredFromTimestamp,
        );
        if (sourceHeader.timestamp > requiredFromTimestamp) {
          throw new DataLayerError(
            "INSUFFICIENT_HISTORY",
            "RPC history does not reach the required observation boundary.",
          );
        }
        await this.assertRpcIdentity(sourceHeader.blockNumber);
        this.store.retainHeaders([sourceHeader], "source_boundary");
        this.store.initializeSource({
          blockNumber: sourceHeader.blockNumber,
          blockHash: sourceHeader.blockHash,
          timestamp: sourceHeader.timestamp,
          requiredFromTimestamp,
        });
        state = this.store.getState();
      } else if (
        state.requiredFromTimestamp !== null &&
        state.requiredFromTimestamp > requiredFromTimestamp
      ) {
        this.progress("required horizon moved earlier; resetting for a complete replay");
        this.store.resetForReplay();
        return this.syncOnce(requiredFromTimestamp);
      }

      const targetHead = await this.rpc.getBlockNumber();
      let rangeStart =
        state.indexedThroughBlock === null
          ? state.sourceFromBlock as number
          : state.indexedThroughBlock + 1;
      while (rangeStart <= targetHead) {
        const batchStarted = performance.now();
        const throughBlock = Math.min(rangeStart + this.maxRangeBlocks - 1, targetHead);
        const priorHeader =
          rangeStart > (state.sourceFromBlock as number)
            ? this.store.getHeader(rangeStart - 1)
            : undefined;
        if (rangeStart > (state.sourceFromBlock as number) && priorHeader === undefined) {
          throw new DataLayerError("INDEX_CORRUPT", "Indexed cursor header is missing.");
        }
        const batch = await this.buildBatch(rangeStart, throughBlock, priorHeader);
        this.store.commitBatch(batch);
        lastBatchDurationMs = performance.now() - batchStarted;
        batchesCommitted += 1;
        eventPages += batch.eventPages;
        this.progress(
          `committed canonical range ${rangeStart}..${throughBlock} (${batch.events.length} public events)`,
        );
        rangeStart = throughBlock + 1;
      }

      await this.retainDenseCursorWindow();
      const snapshotStarted = performance.now();
      const complete = await this.finalizeSnapshot();
      const snapshotDurationMs = performance.now() - snapshotStarted;
      const metrics = {
        syncDurationMs: performance.now() - syncStarted,
        lastBatchDurationMs,
        snapshotDurationMs,
      };
      this.store.recordSyncSuccess({
        blockNumber: complete.snapshot.observedBlock,
        provider: this.rpcProviderName ?? null,
        syncDurationMs: metrics.syncDurationMs,
        batchDurationMs: metrics.lastBatchDurationMs,
        snapshotDurationMs: metrics.snapshotDurationMs,
      });
      return {
        status: "COMPLETE",
        snapshot: complete.snapshot,
        snapshotHash: complete.snapshotHash,
        batchesCommitted,
        eventPages,
        reorg,
        metrics,
      };
    } catch (error) {
      const failure = asDataLayerError(error);
      this.store.setStatus("ERROR", failure.code);
      throw failure;
    }
  }
}
