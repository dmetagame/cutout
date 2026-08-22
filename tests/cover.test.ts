import assert from "node:assert/strict";
import test from "node:test";

import {
  CUTOUT_MODEL_V1_4,
  FRESHNESS_POLICY,
  SpikeError,
  buildPublicCover,
  hashPublicSnapshot,
  loadPoolAbiFixture,
  mainnetConfig,
  reviewPoolAbi,
} from "../src/index.js";
import type {
  Address,
  BlockReference,
  PublicDepositObservation,
  PublicSnapshot,
  PublicWithdrawalObservation,
} from "../src/index.js";
import { normalizeAddress } from "../src/starknet/felt.js";

const fixture = await loadPoolAbiFixture();
const abi = reviewPoolAbi(fixture);
const config = mainnetConfig({
  CHAIN_ID: fixture.provenance.chainId,
  POOL_ADDRESS: fixture.provenance.poolAddress,
  RPC_URL: "https://fixture.invalid",
});
const configuredToken = config.tokens[0] ?? (() => {
  throw new Error("test token configuration is missing");
})();

const now = 2_000_000_000;
const sourceFromBlock = config.poolDeploymentBlock;
const sourceParentBlock = sourceFromBlock + 1;
const observedBlock = sourceFromBlock + 2;
const rpcHeadBlock = sourceFromBlock + 3;
const sourceFromTimestamp = now - CUTOUT_MODEL_V1_4.observationSeconds - 60;

function reference(
  blockNumber: number,
  blockHash: string,
  parentHash: string,
  timestamp: number,
): BlockReference {
  return { blockNumber, blockHash, parentHash, timestamp };
}

function deposit(
  amount: bigint,
  timestamp: number,
  index: number,
  depositor: Address = `0x${(100 + index).toString(16)}` as Address,
): PublicDepositObservation {
  const normalizedDepositor = normalizeAddress(depositor, "test depositor");
  const blockNumber = sourceParentBlock;
  const transactionHash = `0x${(1_000 + index).toString(16)}` as `0x${string}`;
  return {
    blockNumber,
    blockHash: "0x101",
    timestamp,
    transactionHash,
    eventIndex: index,
    eventId: `${blockNumber}:${transactionHash}:${index}`,
    eventSelector: abi.deposit.selector,
    depositor: normalizedDepositor,
    token: configuredToken.address,
    amount,
    normalizedFields: {
      depositor: normalizedDepositor,
      token: configuredToken.address,
      amount: amount.toString(10),
    },
  };
}

function withdrawal(
  amount: bigint,
  timestamp: number,
  index: number,
  recipient: Address = `0x${(500 + index).toString(16)}` as Address,
): PublicWithdrawalObservation {
  const normalizedRecipient = normalizeAddress(recipient, "test recipient");
  const blockNumber = sourceParentBlock;
  const transactionHash = `0x${(5_000 + index).toString(16)}` as `0x${string}`;
  return {
    blockNumber,
    blockHash: "0x101",
    timestamp,
    transactionHash,
    eventIndex: index,
    eventId: `${blockNumber}:${transactionHash}:${index}`,
    eventSelector: abi.withdrawal.selector,
    recipient: normalizedRecipient,
    token: configuredToken.address,
    amount,
    normalizedFields: {
      recipient: normalizedRecipient,
      token: configuredToken.address,
      amount: amount.toString(10),
    },
  };
}

function snapshot(
  deposits: readonly PublicDepositObservation[],
  withdrawals: readonly PublicWithdrawalObservation[] = [],
): PublicSnapshot {
  return {
    chainId: config.chainId,
    poolAddress: config.poolAddress,
    poolClassHash: abi.classHash,
    poolAbiFixtureVersion: abi.fixtureVersion,
    observedBlock,
    observedBlockHash: "0x102",
    observedTimestamp: now - 2,
    indexedThroughBlock: observedBlock,
    indexedThroughHash: "0x102",
    indexedThroughTimestamp: now - 2,
    rpcHeadBlock,
    rpcHeadHash: "0x103",
    rpcHeadTimestamp: now - 1,
    sourceFromBlock,
    sourceFromHash: "0x100",
    sourceFromTimestamp,
    requiredFromTimestamp: now - CUTOUT_MODEL_V1_4.observationSeconds,
    sourceComplete: true,
    pagesComplete: true,
    queriedSelectors: [
      abi.deposit.selector,
      abi.withdrawal.selector,
      abi.viewingKeySet.selector,
    ],
    sourceParentBlock,
    sourceParentHash: "0x101",
    sourceDeclaredParentHash: "0x101",
    blockReferences: [
      reference(sourceFromBlock, "0x100", "0xff", sourceFromTimestamp),
      reference(sourceParentBlock, "0x101", "0x100", now - 300),
      reference(observedBlock, "0x102", "0x101", now - 2),
      reference(rpcHeadBlock, "0x103", "0x102", now - 1),
    ],
    depositObservations: deposits,
    withdrawalObservations: withdrawals,
    viewingKeyRegistrationObservations: [],
    engineVersion: CUTOUT_MODEL_V1_4.version,
    freshnessPolicyVersion: FRESHNESS_POLICY.version,
  };
}

test("public cover binds to a current snapshot and reports the exact unmatched-event share", () => {
  const deposits = Array.from({ length: 205 }, (_, index) =>
    deposit(index < 2 ? 1n : BigInt(index), now - 300, index),
  );
  const source = snapshot(deposits);
  const cover = buildPublicCover({ snapshot: source, config, abi, now });
  const token = cover.tokens.find((candidate) => candidate.address === configuredToken.address);

  assert.equal(cover.snapshotHash, hashPublicSnapshot(source));
  assert.equal(cover.engineVersion, CUTOUT_MODEL_V1_4.version);
  assert.equal(cover.freshness.sourceAgeSeconds, 2);
  const depositsCover = token?.actions.find((candidate) => candidate.action === "shield");
  assert.equal(depositsCover?.unmatchedExactShare, 204 / 205);
  assert.equal(depositsCover?.cohorts.length, 7);
  assert.equal(depositsCover?.cohorts[0]?.amount, "1");
  assert.equal(depositsCover?.cohorts[0]?.existingMatches, 2);
});

test("public cover keeps deposit and withdrawal cohorts separate without raw actors", () => {
  const privateLookingAddress = "0xdeadbeef" as Address;
  const cover = buildPublicCover({
    snapshot: snapshot(
      [deposit(50n, now - 300, 0, privateLookingAddress)],
      [withdrawal(75n, now - 300, 0, privateLookingAddress)],
    ),
    config,
    abi,
    now,
  });
  const token = cover.tokens[0];
  const depositsCover = token?.actions.find((candidate) => candidate.action === "shield");
  const withdrawalsCover = token?.actions.find((candidate) => candidate.action === "withdraw");

  assert.equal(JSON.stringify(cover).includes(privateLookingAddress), false);
  assert.equal(depositsCover?.cohorts[0]?.amount, "50");
  assert.equal(withdrawalsCover?.cohorts[0]?.amount, "75");
  assert.equal("depositor" in (depositsCover?.cohorts[0] ?? {}), false);
  assert.equal("recipient" in (withdrawalsCover?.cohorts[0] ?? {}), false);
});

test("public cover is deterministic when canonical observations arrive in another order", () => {
  const deposits = [
    deposit(25n, now - 300, 0),
    deposit(10n, now - 300, 1),
    deposit(25n, now - 300, 2),
  ];
  const withdrawals = [
    withdrawal(40n, now - 300, 0),
    withdrawal(30n, now - 300, 1),
    withdrawal(40n, now - 300, 2),
  ];
  const forward = buildPublicCover({
    snapshot: snapshot(deposits, withdrawals),
    config,
    abi,
    now,
  });
  const reversed = buildPublicCover({
    snapshot: snapshot([...deposits].reverse(), [...withdrawals].reverse()),
    config,
    abi,
    now,
  });

  assert.deepEqual(reversed, forward);
});

test("public cover rejects stale or incomplete snapshots without returning aggregate evidence", () => {
  const stale = {
    ...snapshot([]),
    rpcHeadTimestamp: now - 120,
    indexedThroughTimestamp: now - 121,
    observedTimestamp: now - 121,
    blockReferences: snapshot([]).blockReferences.map((item) =>
      item.blockNumber === sourceParentBlock
        ? { ...item, timestamp: now - 122 }
        : item.blockNumber === observedBlock
          ? { ...item, timestamp: now - 121 }
          : item.blockNumber === rpcHeadBlock
            ? { ...item, timestamp: now - 120 }
            : item,
    ),
  };
  assert.throws(
    () => buildPublicCover({ snapshot: stale, config, abi, now }),
    (error: unknown) => error instanceof SpikeError && error.code === "RPC_DATA_STALE",
  );

  const incomplete = { ...snapshot([]), pagesComplete: false };
  assert.throws(
    () => buildPublicCover({ snapshot: incomplete, config, abi, now }),
    (error: unknown) => error instanceof SpikeError && error.code === "SOURCE_INCOMPLETE",
  );
});
