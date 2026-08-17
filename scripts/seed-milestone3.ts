import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { CUTOUT_MODEL } from "../src/engine/constants.js";
import type { Address, TransactionHash } from "../src/engine/types.js";
import { CanonicalStore } from "../src/indexer/store.js";
import { loadPoolAbiFixture, reviewPoolAbi } from "../src/starknet/abi.js";
import { mainnetConfig } from "../src/starknet/config.js";
import { normalizeAddress, normalizeFelt } from "../src/starknet/felt.js";
import { FRESHNESS_POLICY } from "../src/starknet/policies.js";
import type {
  BlockReference,
  PublicDepositObservation,
  PublicSnapshot,
} from "../src/starknet/types.js";

const DAY = 86_400;
const now = Number(process.env.CUTOUT_FIXED_NOW ?? "2000000000");
if (!Number.isSafeInteger(now) || now <= 0) throw new Error("CUTOUT_FIXED_NOW must be a positive integer.");

const path = resolve(process.env.CUTOUT_DB_PATH ?? "data/milestone3-fixture.sqlite");
if (!path.endsWith(".sqlite")) throw new Error("Fixture database path must end in .sqlite.");
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });

const config = mainnetConfig({
  CHAIN_ID: process.env.CHAIN_ID,
  POOL_ADDRESS: process.env.POOL_ADDRESS,
  RPC_URL: process.env.RPC_URL ?? "https://cutout-rpc.invalid",
  CUTOUT_RPC_RANGE_BLOCKS: "200000",
});
const abi = reviewPoolAbi(await loadPoolAbiFixture());
const usdc = config.tokens.find((candidate) => candidate.symbol === "USDC")!;

const targetAmount = 4_713_220_000n;
const recommendedAmount = 4_700_000_000n;
const sourceFromBlock = config.poolDeploymentBlock;
const observedBlock = 9_000_100;
const rpcHeadBlock = observedBlock + 1;
const sourceParentBlock = observedBlock - 1;
const observedTimestamp = now - 10;
const rpcHeadTimestamp = now - 8;
const requiredFromTimestamp = now - CUTOUT_MODEL.observationSeconds;
const sourceFromTimestamp = requiredFromTimestamp - 600;

function hashFor(blockNumber: number): string {
  return normalizeFelt(`0x${(0x1000000 + blockNumber).toString(16)}`, "fixture block hash");
}

function reference(
  blockNumber: number,
  timestamp: number,
  parentHash = hashFor(blockNumber - 1),
): BlockReference {
  return { blockNumber, blockHash: hashFor(blockNumber), parentHash, timestamp };
}

const observations: PublicDepositObservation[] = [];
const references = new Map<number, BlockReference>();

function addDeposit(input: {
  readonly blockNumber: number;
  readonly timestamp: number;
  readonly depositor: string;
  readonly amount: bigint;
  readonly ordinal: number;
}): void {
  const depositor = normalizeAddress(input.depositor, "fixture depositor");
  const transactionHash = normalizeFelt(
    `0x${(0x200000 + input.ordinal).toString(16)}`,
    "fixture transaction hash",
  ) as TransactionHash;
  const blockHash = hashFor(input.blockNumber);
  references.set(input.blockNumber, reference(input.blockNumber, input.timestamp));
  observations.push({
    blockNumber: input.blockNumber,
    blockHash,
    timestamp: input.timestamp,
    transactionHash,
    depositor,
    token: usdc.address,
    amount: input.amount,
    eventIndex: input.ordinal,
    eventId: `${input.blockNumber}:${transactionHash}:${input.ordinal}`,
    eventSelector: abi.deposit.selector,
    normalizedFields: {
      depositor,
      token: usdc.address,
      amount: input.amount.toString(10),
    },
  });
}

for (let index = 0; index < 5; index += 1) {
  addDeposit({
    blockNumber: 8_999_900 + index * 10,
    timestamp: now - 300 - index * 240,
    depositor: `0x${(0x201 + index).toString(16)}`,
    amount: recommendedAmount,
    ordinal: index,
  });
}
for (let index = 0; index < 6; index += 1) {
  addDeposit({
    blockNumber: 8_999_000 + index * 10,
    timestamp: now - (index + 2) * DAY,
    depositor: `0x${(0x301 + index).toString(16)}`,
    amount: recommendedAmount,
    ordinal: index + 5,
  });
}
addDeposit({
  blockNumber: 8_999_970,
  timestamp: now - 600,
  depositor: "0x401",
  amount: 4_800_000_000n,
  ordinal: 11,
});

references.set(sourceFromBlock, reference(sourceFromBlock, sourceFromTimestamp));
const sourceParentHash = hashFor(sourceParentBlock);
references.set(sourceParentBlock, reference(sourceParentBlock, observedTimestamp - 2));
references.set(
  observedBlock,
  reference(observedBlock, observedTimestamp, sourceParentHash),
);
references.set(
  rpcHeadBlock,
  reference(rpcHeadBlock, rpcHeadTimestamp, hashFor(observedBlock)),
);

const snapshot: PublicSnapshot = {
  chainId: config.chainId,
  poolAddress: config.poolAddress,
  poolClassHash: abi.classHash,
  poolAbiFixtureVersion: abi.fixtureVersion,
  observedBlock,
  observedBlockHash: hashFor(observedBlock),
  observedTimestamp,
  indexedThroughBlock: observedBlock,
  indexedThroughHash: hashFor(observedBlock),
  indexedThroughTimestamp: observedTimestamp,
  rpcHeadBlock,
  rpcHeadHash: hashFor(rpcHeadBlock),
  rpcHeadTimestamp,
  sourceFromBlock,
  sourceFromHash: hashFor(sourceFromBlock),
  sourceFromTimestamp,
  requiredFromTimestamp,
  sourceComplete: true,
  pagesComplete: true,
  queriedSelectors: [abi.deposit.selector, abi.viewingKeySet.selector],
  sourceParentBlock,
  sourceParentHash,
  sourceDeclaredParentHash: sourceParentHash,
  blockReferences: [...references.values()],
  depositObservations: observations,
  viewingKeyRegistrationObservations: [],
  engineVersion: CUTOUT_MODEL.version,
  freshnessPolicyVersion: FRESHNESS_POLICY.version,
};

const store = new CanonicalStore({ path, config, abi, now: () => now });
try {
  const snapshotHash = store.persistCompleteSnapshot(snapshot);
  console.log(JSON.stringify({
    status: "COMPLETE",
    path,
    snapshotHash,
    observedBlock,
    observedTimestamp,
    targetAmount: targetAmount.toString(10),
    recommendedAmount: recommendedAmount.toString(10),
    deposits: observations.length,
  }));
} finally {
  store.close();
}
