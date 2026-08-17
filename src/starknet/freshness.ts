import { CUTOUT_MODEL } from "../engine/constants.js";
import type { StarknetSpikeConfig } from "./config.js";
import type { ReviewedPoolAbi } from "./abi.js";
import { SpikeError } from "./errors.js";
import {
  MAX_U128,
  normalizeAddress,
  normalizeFelt,
  normalizeTransactionHash,
} from "./felt.js";
import { FRESHNESS_POLICY } from "./policies.js";
import type {
  BlockReference,
  PublicSnapshot,
  SnapshotFreshness,
  SpikeShieldIntent,
} from "./types.js";

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SpikeError("SNAPSHOT_INCOMPLETE", `${field} is missing or invalid.`);
  }
  return value;
}

function referenceMap(references: readonly BlockReference[]): ReadonlyMap<number, BlockReference> {
  const map = new Map<number, BlockReference>();
  for (const reference of references) {
    requireInteger(reference.blockNumber, "block reference number");
    requireInteger(reference.timestamp, "block reference timestamp");
    normalizeFelt(reference.blockHash, "block reference hash");
    normalizeFelt(reference.parentHash, "block reference parent hash");
    const prior = map.get(reference.blockNumber);
    if (
      prior !== undefined &&
      (normalizeFelt(prior.blockHash, "prior block hash") !==
        normalizeFelt(reference.blockHash, "duplicate block hash") ||
        normalizeFelt(prior.parentHash, "prior parent hash") !==
          normalizeFelt(reference.parentHash, "duplicate parent hash") ||
        prior.timestamp !== reference.timestamp)
    ) {
      throw new SpikeError("BLOCK_HASH_INCONSISTENT", "Duplicate block references disagree.");
    }
    map.set(reference.blockNumber, reference);
  }
  return map;
}

function validateAdjacentReferences(
  references: ReadonlyMap<number, BlockReference>,
): void {
  const ordered = [...references.values()].sort(
    (left, right) => left.blockNumber - right.blockNumber,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const prior = ordered[index - 1];
    const current = ordered[index];
    if (prior === undefined || current === undefined) continue;
    if (current.blockNumber !== prior.blockNumber + 1) continue;
    if (
      normalizeFelt(current.parentHash, "adjacent parent hash") !==
      normalizeFelt(prior.blockHash, "adjacent block hash")
    ) {
      throw new SpikeError(
        "PARENT_LINK_BROKEN",
        `Block ${current.blockNumber} does not link to block ${prior.blockNumber}.`,
      );
    }
    if (current.timestamp < prior.timestamp) {
      throw new SpikeError(
        "PARENT_LINK_BROKEN",
        `Block ${current.blockNumber} timestamp is not monotonic.`,
      );
    }
  }
}

function requireReference(
  references: ReadonlyMap<number, BlockReference>,
  blockNumber: number,
  expectedHash: string,
  expectedTimestamp: number | undefined,
): BlockReference {
  const reference = references.get(blockNumber);
  if (reference === undefined) {
    throw new SpikeError("SNAPSHOT_INCOMPLETE", `Block ${blockNumber} has no retained reference.`);
  }
  if (normalizeFelt(reference.blockHash, "block hash") !== normalizeFelt(expectedHash, "expected hash")) {
    throw new SpikeError("BLOCK_HASH_INCONSISTENT", `Block ${blockNumber} hash is inconsistent.`);
  }
  if (expectedTimestamp !== undefined && reference.timestamp !== expectedTimestamp) {
    throw new SpikeError("BLOCK_HASH_INCONSISTENT", `Block ${blockNumber} timestamp is inconsistent.`);
  }
  return reference;
}

export function validatePublicSnapshot(
  snapshot: PublicSnapshot,
  intent: SpikeShieldIntent,
  config: StarknetSpikeConfig,
  abi: ReviewedPoolAbi,
): SnapshotFreshness {
  if (snapshot === null || typeof snapshot !== "object") {
    throw new SpikeError("SNAPSHOT_INCOMPLETE", "Public snapshot is missing.");
  }
  if (normalizeFelt(snapshot.chainId, "snapshot chain id") !== config.chainId) {
    throw new SpikeError("CHAIN_ID_MISMATCH", "Snapshot chain does not match the configured chain.");
  }
  if (normalizeAddress(snapshot.poolAddress, "snapshot pool") !== config.poolAddress) {
    throw new SpikeError("POOL_ADDRESS_MISMATCH", "Snapshot pool does not match configuration.");
  }
  if (normalizeFelt(snapshot.poolClassHash, "snapshot class hash") !== abi.classHash) {
    throw new SpikeError("POOL_ABI_MISMATCH", "Snapshot pool class does not match the reviewed ABI.");
  }
  if (snapshot.poolAbiFixtureVersion !== abi.fixtureVersion) {
    throw new SpikeError("POOL_ABI_MISMATCH", "Snapshot ABI fixture version is inconsistent.");
  }
  if (snapshot.engineVersion !== CUTOUT_MODEL.version) {
    throw new SpikeError("ENGINE_VERSION_MISMATCH", "Snapshot engine version is inconsistent.");
  }
  if (snapshot.freshnessPolicyVersion !== FRESHNESS_POLICY.version) {
    throw new SpikeError(
      "FRESHNESS_POLICY_VERSION_MISMATCH",
      "Snapshot freshness policy version is inconsistent.",
    );
  }
  if (!Array.isArray(snapshot.blockReferences)) {
    throw new SpikeError("SNAPSHOT_INCOMPLETE", "Snapshot block references are missing.");
  }
  if (
    !Array.isArray(snapshot.depositObservations) ||
    !Array.isArray(snapshot.viewingKeyRegistrationObservations) ||
    !Array.isArray(snapshot.queriedSelectors)
  ) {
    throw new SpikeError("SNAPSHOT_INCOMPLETE", "Snapshot observations are missing.");
  }

  const observedBlock = requireInteger(snapshot.observedBlock, "observed block");
  const indexedBlock = requireInteger(snapshot.indexedThroughBlock, "indexed-through block");
  const rpcHeadBlock = requireInteger(snapshot.rpcHeadBlock, "RPC head block");
  const sourceFromBlock = requireInteger(snapshot.sourceFromBlock, "source-from block");
  const sourceParentBlock = requireInteger(snapshot.sourceParentBlock, "source parent block");
  requireInteger(snapshot.observedTimestamp, "observed timestamp");
  requireInteger(snapshot.indexedThroughTimestamp, "indexed-through timestamp");
  requireInteger(snapshot.rpcHeadTimestamp, "RPC head timestamp");
  requireInteger(snapshot.sourceFromTimestamp, "source-from timestamp");
  requireInteger(snapshot.requiredFromTimestamp, "required-from timestamp");

  if (intent.evaluationBlock !== observedBlock) {
    throw new SpikeError("SNAPSHOT_INCOMPLETE", "Intent evaluation block does not match the snapshot.");
  }
  if (
    sourceFromBlock < config.poolDeploymentBlock ||
    sourceFromBlock > observedBlock ||
    observedBlock > indexedBlock ||
    indexedBlock > rpcHeadBlock
  ) {
    throw new SpikeError("RPC_HEAD_INCONSISTENT", "Observed/source/RPC block order is inconsistent.");
  }
  if (snapshot.sourceFromTimestamp > snapshot.observedTimestamp) {
    throw new SpikeError("RPC_HEAD_INCONSISTENT", "Source boundary timestamp is ahead of the observation.");
  }
  if (snapshot.observedTimestamp > snapshot.indexedThroughTimestamp) {
    throw new SpikeError("RPC_HEAD_INCONSISTENT", "Observed timestamp is ahead of the source.");
  }
  if (snapshot.indexedThroughTimestamp > snapshot.rpcHeadTimestamp) {
    throw new SpikeError("RPC_HEAD_INCONSISTENT", "RPC head timestamp trails the source timestamp.");
  }
  if (intent.evaluationTimestamp < snapshot.observedTimestamp) {
    throw new SpikeError("RPC_HEAD_INCONSISTENT", "Evaluation timestamp predates its observed block.");
  }

  const references = referenceMap(snapshot.blockReferences);
  validateAdjacentReferences(references);
  requireReference(
    references,
    sourceFromBlock,
    snapshot.sourceFromHash,
    snapshot.sourceFromTimestamp,
  );
  const observedReference = requireReference(
    references,
    observedBlock,
    snapshot.observedBlockHash,
    snapshot.observedTimestamp,
  );
  const indexedReference = requireReference(
    references,
    indexedBlock,
    snapshot.indexedThroughHash,
    snapshot.indexedThroughTimestamp,
  );
  requireReference(
    references,
    rpcHeadBlock,
    snapshot.rpcHeadHash,
    snapshot.rpcHeadTimestamp,
  );
  const parentReference = requireReference(
    references,
    sourceParentBlock,
    snapshot.sourceParentHash,
    undefined,
  );
  if (sourceParentBlock !== indexedBlock - 1) {
    throw new SpikeError("PARENT_LINK_BROKEN", "Source parent block is not adjacent.");
  }
  if (
    normalizeFelt(indexedReference.parentHash, "source declared parent") !==
      normalizeFelt(parentReference.blockHash, "source parent hash") ||
    normalizeFelt(snapshot.sourceDeclaredParentHash, "snapshot declared parent") !==
      normalizeFelt(snapshot.sourceParentHash, "snapshot parent hash")
  ) {
    throw new SpikeError("PARENT_LINK_BROKEN", "Source parent link is broken.");
  }
  if (parentReference.timestamp > indexedReference.timestamp) {
    throw new SpikeError("PARENT_LINK_BROKEN", "Source parent timestamp is not monotonic.");
  }
  if (
    observedBlock === indexedBlock &&
    observedReference.blockHash !== indexedReference.blockHash
  ) {
    throw new SpikeError("BLOCK_HASH_INCONSISTENT", "Observed and source hashes disagree.");
  }

  if (snapshot.sourceComplete !== true || snapshot.pagesComplete !== true) {
    throw new SpikeError("SOURCE_INCOMPLETE", "Required event source is incomplete.");
  }
  const expectedSelectors = [abi.deposit.selector, abi.viewingKeySet.selector].sort();
  const queriedSelectors = snapshot.queriedSelectors.map((item) =>
    normalizeFelt(item, "queried selector"),
  ).sort();
  if (JSON.stringify(queriedSelectors) !== JSON.stringify(expectedSelectors)) {
    throw new SpikeError("SOURCE_INCOMPLETE", "Required event selectors were not both queried.");
  }
  const requiredHorizon = intent.evaluationTimestamp - CUTOUT_MODEL.observationSeconds;
  if (snapshot.sourceFromTimestamp > snapshot.requiredFromTimestamp) {
    throw new SpikeError("SOURCE_INCOMPLETE", "Source does not cover its declared requested boundary.");
  }
  if (snapshot.sourceFromTimestamp > requiredHorizon) {
    throw new SpikeError("SOURCE_INCOMPLETE", "Source range does not cover the model horizon.");
  }
  if (snapshot.requiredFromTimestamp > requiredHorizon) {
    throw new SpikeError("SOURCE_INCOMPLETE", "Snapshot requested an insufficient history horizon.");
  }

  const eventIds = new Set<string>();
  const validateObservation = (
    observation: {
      readonly blockNumber: number;
      readonly blockHash: string;
      readonly timestamp: number;
      readonly eventId: string;
      readonly eventIndex: number;
      readonly eventSelector: string;
    },
    selector: string,
  ) => {
    requireInteger(observation.blockNumber, "observation block");
    requireInteger(observation.timestamp, "observation timestamp");
    requireInteger(observation.eventIndex, "observation event index");
    if (observation.blockNumber < snapshot.sourceFromBlock || observation.blockNumber > indexedBlock) {
      throw new SpikeError("SOURCE_INCOMPLETE", "Observation lies outside the declared source range.");
    }
    const reference = requireReference(
      references,
      observation.blockNumber,
      observation.blockHash,
      observation.timestamp,
    );
    if (reference.blockHash !== observation.blockHash) {
      throw new SpikeError("BLOCK_HASH_INCONSISTENT", "Observation block hash is inconsistent.");
    }
    if (normalizeFelt(observation.eventSelector, "observation selector") !== selector) {
      throw new SpikeError("UNKNOWN_EVENT_SELECTOR", "Observation selector is not the expected ABI selector.");
    }
    if (eventIds.has(observation.eventId)) {
      throw new SpikeError("SOURCE_INCOMPLETE", "Snapshot contains a duplicate event identity.");
    }
    const transactionHash = normalizeTransactionHash(
      "transactionHash" in observation ? observation.transactionHash : undefined,
      "observation transaction hash",
    );
    const expectedEventId = `${observation.blockNumber}:${transactionHash}:${observation.eventIndex}`;
    if (observation.eventId !== expectedEventId) {
      throw new SpikeError("SNAPSHOT_INCOMPLETE", "Observation event identity is inconsistent.");
    }
    eventIds.add(observation.eventId);
  };

  for (const deposit of snapshot.depositObservations) {
    validateObservation(deposit, abi.deposit.selector);
    if (
      typeof deposit.amount !== "bigint" ||
      deposit.amount < 0n ||
      deposit.amount > MAX_U128
    ) {
      throw new SpikeError("SNAPSHOT_INCOMPLETE", "Deposit amount is malformed.");
    }
    if (normalizeAddress(deposit.depositor, "deposit account") !== deposit.normalizedFields.depositor) {
      throw new SpikeError("SNAPSHOT_INCOMPLETE", "Deposit normalized account is inconsistent.");
    }
    if (normalizeAddress(deposit.token, "deposit token") !== deposit.normalizedFields.token) {
      throw new SpikeError("SNAPSHOT_INCOMPLETE", "Deposit normalized token is inconsistent.");
    }
    if (deposit.amount.toString(10) !== deposit.normalizedFields.amount) {
      throw new SpikeError("SNAPSHOT_INCOMPLETE", "Deposit normalized amount is inconsistent.");
    }
  }
  for (const registration of snapshot.viewingKeyRegistrationObservations) {
    validateObservation(registration, abi.viewingKeySet.selector);
    if (
      normalizeAddress(registration.account, "registration account") !==
      registration.normalizedFields.account
    ) {
      throw new SpikeError("SNAPSHOT_INCOMPLETE", "Registration normalized account is inconsistent.");
    }
  }

  const sourceAgeSeconds = intent.evaluationTimestamp - snapshot.indexedThroughTimestamp;
  if (sourceAgeSeconds < 0) {
    throw new SpikeError("RPC_HEAD_INCONSISTENT", "Source timestamp is ahead of evaluation time.");
  }
  if (sourceAgeSeconds > FRESHNESS_POLICY.maximumSourceAgeSeconds) {
    throw new SpikeError("RPC_DATA_STALE", "Public source is older than 120 seconds.");
  }
  const indexLagSeconds = snapshot.rpcHeadTimestamp - snapshot.indexedThroughTimestamp;
  if (indexLagSeconds < 0) {
    throw new SpikeError("RPC_HEAD_INCONSISTENT", "RPC head timestamp is behind the source.");
  }
  if (indexLagSeconds > FRESHNESS_POLICY.maximumIndexLagSeconds) {
    throw new SpikeError("INDEX_LAG_EXCEEDED", "Public source trails RPC head by more than 120 seconds.");
  }

  return {
    policyVersion: FRESHNESS_POLICY.version,
    maximumSourceAgeSeconds: FRESHNESS_POLICY.maximumSourceAgeSeconds,
    maximumIndexLagSeconds: FRESHNESS_POLICY.maximumIndexLagSeconds,
    sourceAgeSeconds,
    indexLagSeconds,
    observedBlock,
    indexedThroughBlock: indexedBlock,
    rpcHeadBlock,
    sourceComplete: true,
  };
}
