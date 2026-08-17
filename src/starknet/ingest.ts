import { CUTOUT_MODEL } from "../engine/constants.js";
import type { PoolAbiFixture, ReviewedPoolAbi } from "./abi.js";
import {
  assertLiveAbiMatchesFixture,
  reviewPoolAbi,
} from "./abi.js";
import type { StarknetSpikeConfig } from "./config.js";
import { SpikeError } from "./errors.js";
import { decodePoolEvent } from "./events.js";
import { normalizeAddress, normalizeFelt } from "./felt.js";
import { FRESHNESS_POLICY } from "./policies.js";
import type {
  PublicRpc,
  RpcBlockHeader,
  RpcEvent,
  RpcEventFilter,
} from "./rpc.js";
import type {
  BlockReference,
  PublicDepositObservation,
  PublicRegistrationObservation,
  PublicSnapshot,
} from "./types.js";

interface CollectedEvent {
  readonly raw: RpcEvent;
  readonly sourceOrdinal: number;
}

export interface IngestSnapshotOptions {
  readonly rpc: PublicRpc;
  readonly config: StarknetSpikeConfig;
  readonly fixture: PoolAbiFixture;
  readonly requiredFromTimestamp: number;
  readonly sourceFromBlock?: number;
  readonly onProgress?: (message: string) => void;
}

export interface IngestSnapshotResult {
  readonly snapshot: PublicSnapshot;
  readonly abi: ReviewedPoolAbi;
  readonly eventPages: number;
}

function progress(options: IngestSnapshotOptions, message: string): void {
  options.onProgress?.(message);
}

async function findBlockAtOrBeforeTimestamp(
  rpc: PublicRpc,
  firstBlock: number,
  lastBlock: number,
  targetTimestamp: number,
  cache: Map<number, RpcBlockHeader>,
): Promise<number> {
  const get = async (blockNumber: number) => {
    const cached = cache.get(blockNumber);
    if (cached !== undefined) return cached;
    const header = await rpc.getBlock(blockNumber);
    cache.set(blockNumber, header);
    return header;
  };
  const first = await get(firstBlock);
  if (targetTimestamp <= first.timestamp) return firstBlock;
  let low = firstBlock;
  let high = lastBlock;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const header = await get(middle);
    if (header.timestamp <= targetTimestamp) low = middle;
    else high = middle - 1;
  }
  return low;
}

async function collectSelectorEvents(
  rpc: PublicRpc,
  config: StarknetSpikeConfig,
  selector: string,
  fromBlock: number,
  throughBlock: number,
  sourceOrdinalStart: number,
  onProgress?: (message: string) => void,
): Promise<{ readonly events: readonly CollectedEvent[]; readonly pages: number }> {
  const events: CollectedEvent[] = [];
  let pages = 0;
  let sourceOrdinal = sourceOrdinalStart;
  for (let rangeStart = fromBlock; rangeStart <= throughBlock; ) {
    const rangeEnd = Math.min(
      rangeStart + config.maxEventRangeBlocks - 1,
      throughBlock,
    );
    let continuationToken: string | undefined;
    const seenTokens = new Set<string>();
    do {
      const base: Omit<RpcEventFilter, "continuation_token"> = {
        from_block: { block_number: rangeStart },
        to_block: { block_number: rangeEnd },
        address: config.poolAddress,
        keys: [[selector]],
        chunk_size: 1_000,
      };
      const filter: RpcEventFilter =
        continuationToken === undefined
          ? base
          : { ...base, continuation_token: continuationToken };
      const page = await rpc.getEvents(filter);
      pages += 1;
      for (const raw of page.events) {
        events.push({ raw, sourceOrdinal });
        sourceOrdinal += 1;
      }
      continuationToken = page.continuationToken;
      if (continuationToken !== undefined) {
        if (seenTokens.has(continuationToken)) {
          throw new SpikeError("SOURCE_INCOMPLETE", "RPC repeated an event continuation token.");
        }
        seenTokens.add(continuationToken);
      }
    } while (continuationToken !== undefined);
    onProgress?.(
      `selector ${selector.slice(0, 10)} range ${rangeStart}..${rangeEnd}: ${events.length} events`,
    );
    rangeStart = rangeEnd + 1;
  }
  return { events, pages };
}

function eventOrder(left: CollectedEvent, right: CollectedEvent): number {
  if (left.raw.block_number !== right.raw.block_number) {
    return left.raw.block_number - right.raw.block_number;
  }
  const transactionOrder = left.raw.transaction_hash.localeCompare(right.raw.transaction_hash);
  if (transactionOrder !== 0) return transactionOrder;
  const leftSelector = left.raw.keys[0] ?? "";
  const rightSelector = right.raw.keys[0] ?? "";
  const selectorOrder = leftSelector.localeCompare(rightSelector);
  if (selectorOrder !== 0) return selectorOrder;
  return left.sourceOrdinal - right.sourceOrdinal;
}

function asReference(header: RpcBlockHeader): BlockReference {
  return {
    blockNumber: header.blockNumber,
    blockHash: header.blockHash,
    parentHash: header.parentHash,
    timestamp: header.timestamp,
  };
}

export async function ingestPublicSnapshot(
  options: IngestSnapshotOptions,
): Promise<IngestSnapshotResult> {
  if (
    !Number.isSafeInteger(options.requiredFromTimestamp) ||
    options.requiredFromTimestamp < 0
  ) {
    throw new SpikeError("SOURCE_INCOMPLETE", "Required source timestamp is invalid.");
  }
  const abi = reviewPoolAbi(options.fixture);
  const configuredChain = normalizeFelt(options.config.chainId, "configured chain id");
  const configuredPool = normalizeAddress(options.config.poolAddress, "configured pool");
  if (abi.chainId !== configuredChain || abi.poolAddress !== configuredPool) {
    throw new SpikeError("POOL_ABI_MISMATCH", "ABI fixture provenance does not match configuration.");
  }

  const chainId = normalizeFelt(await options.rpc.getChainId(), "RPC chain id");
  if (chainId !== configuredChain) {
    throw new SpikeError("CHAIN_ID_MISMATCH", "RPC is connected to the wrong Starknet chain.");
  }
  const sourceThroughBlock = await options.rpc.getBlockNumber();
  const sourceHeader = await options.rpc.getBlock(sourceThroughBlock);
  const sourceParent = await options.rpc.getBlock(sourceThroughBlock - 1);
  if (sourceHeader.parentHash !== sourceParent.blockHash) {
    throw new SpikeError("PARENT_LINK_BROKEN", "Live source head parent link is broken.");
  }

  const classHash = normalizeFelt(
    await options.rpc.getClassHashAt(sourceThroughBlock, configuredPool),
    "live pool class hash",
  );
  if (classHash !== abi.classHash) {
    throw new SpikeError("POOL_ABI_MISMATCH", "Deployed pool class hash changed from the reviewed fixture.");
  }
  const liveClass = await options.rpc.getClass(classHash, sourceThroughBlock);
  assertLiveAbiMatchesFixture(options.fixture, liveClass);
  progress(options, `source head ${sourceThroughBlock}; reviewed class ${classHash}`);

  const headerCache = new Map<number, RpcBlockHeader>([
    [sourceThroughBlock, sourceHeader],
    [sourceThroughBlock - 1, sourceParent],
  ]);
  const sourceFromBlock =
    options.sourceFromBlock ??
    (await findBlockAtOrBeforeTimestamp(
      options.rpc,
      options.config.poolDeploymentBlock,
      sourceThroughBlock,
      options.requiredFromTimestamp,
      headerCache,
    ));
  if (
    !Number.isSafeInteger(sourceFromBlock) ||
    sourceFromBlock < options.config.poolDeploymentBlock ||
    sourceFromBlock > sourceThroughBlock
  ) {
    throw new SpikeError("SOURCE_INCOMPLETE", "Configured event source range is invalid.");
  }
  const sourceFromHeader =
    headerCache.get(sourceFromBlock) ?? (await options.rpc.getBlock(sourceFromBlock));
  headerCache.set(sourceFromBlock, sourceFromHeader);
  progress(
    options,
    `bounded source ${sourceFromBlock}..${sourceThroughBlock} (${sourceFromHeader.timestamp}..${sourceHeader.timestamp})`,
  );

  const depositEvents = await collectSelectorEvents(
    options.rpc,
    options.config,
    abi.deposit.selector,
    sourceFromBlock,
    sourceThroughBlock,
    0,
    options.onProgress,
  );
  const viewingEvents = await collectSelectorEvents(
    options.rpc,
    options.config,
    abi.viewingKeySet.selector,
    sourceFromBlock,
    sourceThroughBlock,
    depositEvents.events.length,
    options.onProgress,
  );
  const collected = [...depositEvents.events, ...viewingEvents.events].sort(eventOrder);

  const eventBlockNumbers = [...new Set(collected.map((event) => event.raw.block_number))];
  const missingBlockNumbers = eventBlockNumbers.filter((block) => !headerCache.has(block));
  const eventHeaders = await options.rpc.getBlocks(missingBlockNumbers);
  for (const header of eventHeaders) headerCache.set(header.blockNumber, header);
  progress(options, `retrieved exact metadata for ${eventBlockNumbers.length} event blocks`);

  const deposits: PublicDepositObservation[] = [];
  const registrations: PublicRegistrationObservation[] = [];
  for (const [eventIndex, event] of collected.entries()) {
    const header = headerCache.get(event.raw.block_number);
    if (header === undefined) {
      throw new SpikeError("SOURCE_INCOMPLETE", "An event-bearing block header is missing.");
    }
    const normalized = decodePoolEvent(
      event.raw,
      eventIndex,
      header,
      configuredPool,
      abi,
    );
    if (normalized.kind === "deposit") deposits.push(normalized.observation);
    else registrations.push(normalized.observation);
  }

  const rpcHeadBlock = await options.rpc.getBlockNumber();
  if (rpcHeadBlock < sourceThroughBlock) {
    throw new SpikeError("RPC_HEAD_INCONSISTENT", "RPC head moved behind the captured source head.");
  }
  const rpcHead = await options.rpc.getBlock(rpcHeadBlock);
  headerCache.set(rpcHeadBlock, rpcHead);
  const rpcHeadParent =
    rpcHeadBlock === sourceThroughBlock
      ? sourceParent
      : await options.rpc.getBlock(rpcHeadBlock - 1);
  if (rpcHead.parentHash !== rpcHeadParent.blockHash) {
    throw new SpikeError("PARENT_LINK_BROKEN", "Live RPC head parent link is broken.");
  }
  headerCache.set(rpcHeadParent.blockNumber, rpcHeadParent);
  const revalidatedSource = await options.rpc.getBlock(sourceThroughBlock);
  if (revalidatedSource.blockHash !== sourceHeader.blockHash) {
    throw new SpikeError("BLOCK_HASH_INCONSISTENT", "Source head changed during ingestion.");
  }
  headerCache.set(sourceThroughBlock, revalidatedSource);
  const headClassHash = normalizeFelt(
    await options.rpc.getClassHashAt(rpcHeadBlock, configuredPool),
    "RPC-head pool class hash",
  );
  if (headClassHash !== classHash) {
    throw new SpikeError("POOL_ABI_MISMATCH", "Pool class changed while the snapshot was built.");
  }

  const blockReferences = [...headerCache.values()]
    .map(asReference)
    .sort((left, right) => left.blockNumber - right.blockNumber);
  const snapshot: PublicSnapshot = {
    chainId,
    poolAddress: configuredPool,
    poolClassHash: classHash,
    poolAbiFixtureVersion: abi.fixtureVersion,
    observedBlock: sourceThroughBlock,
    observedBlockHash: revalidatedSource.blockHash,
    observedTimestamp: revalidatedSource.timestamp,
    indexedThroughBlock: sourceThroughBlock,
    indexedThroughHash: revalidatedSource.blockHash,
    indexedThroughTimestamp: revalidatedSource.timestamp,
    rpcHeadBlock,
    rpcHeadHash: rpcHead.blockHash,
    rpcHeadTimestamp: rpcHead.timestamp,
    sourceFromBlock,
    sourceFromHash: sourceFromHeader.blockHash,
    sourceFromTimestamp: sourceFromHeader.timestamp,
    requiredFromTimestamp: options.requiredFromTimestamp,
    sourceComplete: sourceFromHeader.timestamp <= options.requiredFromTimestamp,
    pagesComplete: true,
    queriedSelectors: [abi.deposit.selector, abi.viewingKeySet.selector],
    sourceParentBlock: sourceParent.blockNumber,
    sourceParentHash: sourceParent.blockHash,
    sourceDeclaredParentHash: revalidatedSource.parentHash,
    blockReferences,
    depositObservations: deposits,
    viewingKeyRegistrationObservations: registrations,
    engineVersion: CUTOUT_MODEL.version,
    freshnessPolicyVersion: FRESHNESS_POLICY.version,
  };
  return {
    snapshot,
    abi,
    eventPages: depositEvents.pages + viewingEvents.pages,
  };
}
