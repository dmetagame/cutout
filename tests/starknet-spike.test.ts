import assert from "node:assert/strict";
import test from "node:test";

import type { STRK20_CALL_AND_PROOF } from "starknet";
import type { Wallet } from "@wallet-standard/base";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";

import {
  CUTOUT_MODEL,
  FRESHNESS_POLICY,
  SpikeError,
  assertLiveAbiMatchesFixture,
  buildDepositAction,
  decodePoolEvent,
  discoverAndInspectWallet,
  hashPublicSnapshot,
  ingestPublicSnapshot,
  inspectWalletCapability,
  loadPoolAbiFixture,
  mainnetConfig,
  prepareDepositSimulation,
  reviewPoolAbi,
  runSpikePreflight,
  selectSupportedApiVersion,
  validatePublicSnapshot,
} from "../src/index.js";
import { normalizeAddress } from "../src/starknet/felt.js";
import type {
  BlockReference,
  PublicDepositObservation,
  PublicRpc,
  PublicSnapshot,
  RpcBlockHeader,
  RpcEvent,
  SpikeShieldIntent,
  StarknetSpikeConfig,
  WalletAccountV6Like,
  WalletAdapterDependencies,
} from "../src/index.js";

const fixture = await loadPoolAbiFixture();
const abi = reviewPoolAbi(fixture);
const config = mainnetConfig({
  CHAIN_ID: "0x534e5f4d41494e",
  POOL_ADDRESS: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  RPC_URL: "https://rpc.invalid.example",
  CUTOUT_RPC_RANGE_BLOCKS: "1000",
});
const configuredTestToken = config.tokens[0];
if (configuredTestToken === undefined) throw new Error("test token configuration is missing");
const token = configuredTestToken.address;

const account = normalizeAddress("0x123", "test account");
const otherAccount = normalizeAddress("0x456", "test account");
const evaluationTimestamp = 2_000_000_000;
const sourceFromBlock = config.poolDeploymentBlock;
const sourceParentBlock = sourceFromBlock + 1;
const observedBlock = sourceFromBlock + 2;
const rpcHeadBlock = sourceFromBlock + 3;

const sourceFromHash = "0x100";
const sourceParentHash = "0x101";
const observedHash = "0x102";
const rpcHeadHash = "0x103";

function reference(
  blockNumber: number,
  blockHash: string,
  parentHash: string,
  timestamp: number,
): BlockReference {
  return { blockNumber, blockHash, parentHash, timestamp };
}

function validSnapshot(): PublicSnapshot {
  const requiredFromTimestamp = evaluationTimestamp - CUTOUT_MODEL.observationSeconds;
  const sourceFromTimestamp = requiredFromTimestamp - 100;
  return {
    chainId: config.chainId,
    poolAddress: config.poolAddress,
    poolClassHash: abi.classHash,
    poolAbiFixtureVersion: abi.fixtureVersion,
    observedBlock,
    observedBlockHash: observedHash,
    observedTimestamp: evaluationTimestamp - 1,
    indexedThroughBlock: observedBlock,
    indexedThroughHash: observedHash,
    indexedThroughTimestamp: evaluationTimestamp - 1,
    rpcHeadBlock,
    rpcHeadHash,
    rpcHeadTimestamp: evaluationTimestamp,
    sourceFromBlock,
    sourceFromHash,
    sourceFromTimestamp,
    requiredFromTimestamp,
    sourceComplete: true,
    pagesComplete: true,
    queriedSelectors: [abi.deposit.selector, abi.viewingKeySet.selector],
    sourceParentBlock,
    sourceParentHash,
    sourceDeclaredParentHash: sourceParentHash,
    blockReferences: [
      reference(sourceFromBlock, sourceFromHash, "0xff", sourceFromTimestamp),
      reference(sourceParentBlock, sourceParentHash, sourceFromHash, evaluationTimestamp - 2),
      reference(observedBlock, observedHash, sourceParentHash, evaluationTimestamp - 1),
      reference(rpcHeadBlock, rpcHeadHash, observedHash, evaluationTimestamp),
    ],
    depositObservations: [],
    viewingKeyRegistrationObservations: [],
    engineVersion: CUTOUT_MODEL.version,
    freshnessPolicyVersion: FRESHNESS_POLICY.version,
  };
}

function validIntent(overrides: Partial<SpikeShieldIntent> = {}): SpikeShieldIntent {
  return {
    action: "shield",
    chainId: config.chainId,
    account,
    token,
    amount: 100n,
    evaluationBlock: observedBlock,
    evaluationTimestamp,
    flexibility: { mode: "exact" },
    deadline: evaluationTimestamp + 3_600,
    ...overrides,
  };
}

function expectSpikeError(
  operation: () => unknown,
  code: SpikeError["code"],
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof SpikeError);
    assert.equal(error.code, code);
    return true;
  });
}

function assertUnavailable(
  snapshot: PublicSnapshot,
  expectedCode: SpikeError["code"],
  intent: SpikeShieldIntent = validIntent(),
): void {
  const result = runSpikePreflight({ snapshot, intent, config, abi });
  assert.equal(result.status, "NO_CONFIDENT_RECOMMENDATION");
  if (result.status !== "NO_CONFIDENT_RECOMMENDATION") return;
  assert.equal(result.error.code, expectedCode);
  assert.equal("decision" in result, false);
  assert.equal("riskBand" in result, false);
}

function rawDepositEvent(block: RpcBlockHeader): RpcEvent {
  return {
    block_hash: block.blockHash,
    block_number: block.blockNumber,
    data: ["0x64"],
    from_address: config.poolAddress,
    keys: [abi.deposit.selector, account, token],
    transaction_hash: "0xd1",
  };
}

function rawViewingKeySetEvent(block: RpcBlockHeader): RpcEvent {
  return {
    block_hash: block.blockHash,
    block_number: block.blockNumber,
    data: ["0xaaaa", "0xbbbb", "0xcccc"],
    from_address: config.poolAddress,
    keys: [abi.viewingKeySet.selector, account, "0x999"],
    transaction_hash: "0xd2",
  };
}

test("reviewed ABI derives the live Deposit and ViewingKeySet selectors", () => {
  assert.equal(
    abi.deposit.selector,
    "0x9149d2123147c5f43d258257fef0b7b969db78269369ebcf5ebb9eef8592f2",
  );
  assert.equal(
    abi.viewingKeySet.selector,
    "0x1321a492485b4f19851fb787ab3800a0030b595332cba93cd5fe40dfb5a4daf",
  );
  assert.equal(abi.deposit.keyFeltCount, 3);
  assert.equal(abi.deposit.dataFeltCount, 1);
  assert.equal(abi.viewingKeySet.keyFeltCount, 3);
  assert.equal(abi.viewingKeySet.dataFeltCount, 3);
  assert.doesNotThrow(() =>
    assertLiveAbiMatchesFixture(fixture, {
      abi: [...fixture.types, ...fixture.events],
    }),
  );
});

test("invalid pool ABI schema fails closed", () => {
  const invalid = structuredClone(fixture) as unknown as {
    events: Array<{ members: Array<{ kind?: string }> }>;
  };
  const deposit = invalid.events[0];
  const amount = deposit?.members[2];
  if (amount !== undefined) amount.kind = "key";
  expectSpikeError(() => reviewPoolAbi(invalid as never), "POOL_ABI_INVALID");
});

test("Deposit events normalize public fields with reproducible provenance", () => {
  const block: RpcBlockHeader = {
    blockNumber: sourceParentBlock,
    blockHash: sourceParentHash,
    parentHash: sourceFromHash,
    timestamp: evaluationTimestamp - 2,
    status: "ACCEPTED_ON_L2",
  };
  const result = decodePoolEvent(rawDepositEvent(block), 7, block, config.poolAddress, abi);
  assert.equal(result.kind, "deposit");
  if (result.kind !== "deposit") return;
  assert.equal(result.observation.amount, 100n);
  assert.equal(result.observation.depositor, account);
  assert.equal(result.observation.token, token);
  assert.equal(result.observation.blockHash, sourceParentHash);
  assert.equal(result.observation.eventIndex, 7);
  assert.equal(
    result.observation.eventId,
    `${sourceParentBlock}:0xd1:7`,
  );
});

test("ViewingKeySet normalization retains registration only, not key payloads", () => {
  const block: RpcBlockHeader = {
    blockNumber: observedBlock,
    blockHash: observedHash,
    parentHash: sourceParentHash,
    timestamp: evaluationTimestamp - 1,
    status: "ACCEPTED_ON_L2",
  };
  const result = decodePoolEvent(
    rawViewingKeySetEvent(block),
    8,
    block,
    config.poolAddress,
    abi,
  );
  assert.equal(result.kind, "viewing-key-registration");
  if (result.kind !== "viewing-key-registration") return;
  assert.equal(result.observation.account, account);
  assert.equal("publicKey" in result.observation, false);
  assert.equal("public_key" in result.observation, false);
  assert.equal("encPrivateKey" in result.observation, false);
  assert.equal("enc_private_key" in result.observation, false);
  assert.equal(JSON.stringify(result.observation).includes("aaaa"), false);
});

test("unknown event selectors fail closed", () => {
  const block: RpcBlockHeader = {
    blockNumber: sourceParentBlock,
    blockHash: sourceParentHash,
    parentHash: sourceFromHash,
    timestamp: evaluationTimestamp - 2,
    status: "ACCEPTED_ON_L2",
  };
  const event = { ...rawDepositEvent(block), keys: ["0xdead", account, token] };
  expectSpikeError(
    () => decodePoolEvent(event, 0, block, config.poolAddress, abi),
    "UNKNOWN_EVENT_SELECTOR",
  );
});

test("typed deposit action accepts only a validated base-unit shield intent", () => {
  const intent = validIntent({
    flexibility: { mode: "flexible", min: 90n, max: 110n },
  });
  assert.deepEqual(buildDepositAction(intent, config, 99n), {
    type: "deposit",
    token,
    amount: "0x63",
  });
  expectSpikeError(
    () => buildDepositAction({ ...intent, action: "withdraw" }, config),
    "UNSUPPORTED_ACTION",
  );
  expectSpikeError(
    () => buildDepositAction({ ...intent, amount: "100" }, config),
    "INVALID_AMOUNT",
  );
  expectSpikeError(() => buildDepositAction(intent, config, 111n), "INVALID_AMOUNT_BOUNDS");
  expectSpikeError(
    () => buildDepositAction({ ...intent, token: normalizeAddress("0x777") }, config),
    "UNSUPPORTED_TOKEN",
  );
});

function starknetWallet(): WalletWithStarknetFeatures {
  return {
    version: "1.0.0",
    name: "Spike Wallet",
    icon: "data:image/png;base64,AA==",
    chains: ["starknet:SN_MAIN"],
    accounts: [],
    features: {
      "starknet:walletApi": {},
      "standard:connect": {},
      "standard:disconnect": {},
      "standard:events": {},
    },
  } as unknown as WalletWithStarknetFeatures;
}

function walletDependencies(
  overrides: Partial<WalletAdapterDependencies> = {},
): WalletAdapterDependencies {
  return {
    supportedWalletApi: async () => ["0.10.3"],
    requestChainId: async () => config.chainId,
    connect: async () => ({
      address: account,
      strk20PrepareInvoke: async () => ({
        call: {
          contract_address: config.poolAddress,
          entry_point: "deposit",
          calldata: [],
        },
        proof: { data: "", output: [], proof_facts: [] },
      }),
    }),
    ...overrides,
  };
}

test("wallet capability detection enforces Wallet API 0.10.3 and mainnet", async (t) => {
  assert.equal(selectSupportedApiVersion(["0.10.2", "0.10.3", "0.11.0"]), "0.11.0");
  assert.equal(selectSupportedApiVersion(["0.10.2", "invalid"]), undefined);

  await t.test("rejects a non-Starknet wallet", async () => {
    const result = await inspectWalletCapability(
      { name: "Other", features: {} } as unknown as Wallet,
      config,
      walletDependencies(),
    );
    assert.deepEqual(result.status, "UNAVAILABLE");
    if (result.status === "UNAVAILABLE") assert.equal(result.code, "UNSUPPORTED_WALLET");
  });

  await t.test("rejects an older Wallet API", async () => {
    const result = await inspectWalletCapability(
      starknetWallet(),
      config,
      walletDependencies({ supportedWalletApi: async () => ["0.10.2"] }),
    );
    assert.equal(result.status, "UNAVAILABLE");
    if (result.status === "UNAVAILABLE") assert.equal(result.code, "UNSUPPORTED_WALLET_API");
  });

  await t.test("rejects the wrong network", async () => {
    const result = await inspectWalletCapability(
      starknetWallet(),
      config,
      walletDependencies({ requestChainId: async () => "0x534e5f5345504f4c4941" }),
    );
    assert.equal(result.status, "UNAVAILABLE");
    if (result.status === "UNAVAILABLE") assert.equal(result.code, "WALLET_NETWORK_MISMATCH");
  });

  await t.test("rejects a wallet with no connected account", async () => {
    const result = await inspectWalletCapability(
      starknetWallet(),
      config,
      walletDependencies({
        connect: async () => ({
          strk20PrepareInvoke: async () => {
            throw new Error("not used");
          },
        }),
      }),
    );
    assert.equal(result.status, "UNAVAILABLE");
    if (result.status === "UNAVAILABLE") assert.equal(result.code, "WALLET_NOT_CONNECTED");
  });

  await t.test("returns a WalletAccountV6-compatible simulation boundary", async () => {
    const result = await inspectWalletCapability(
      starknetWallet(),
      config,
      walletDependencies(),
    );
    assert.equal(result.status, "READY");
    if (result.status !== "READY") return;
    assert.equal(result.selectedApiVersion, "0.10.3");
    assert.equal(result.chainId, config.chainId);
    assert.equal(result.accountAddress, account);
  });

  await t.test("connects before requesting a preauthorization-gated chain ID", async () => {
    const order: string[] = [];
    let connected = false;
    const result = await inspectWalletCapability(
      starknetWallet(),
      config,
      walletDependencies({
        supportedWalletApi: async () => {
          order.push("supportedWalletApi");
          return ["0.10.3"];
        },
        connect: async () => {
          order.push("connect");
          connected = true;
          return {
            address: account,
            strk20PrepareInvoke: async () => {
              throw new Error("not used");
            },
          };
        },
        requestChainId: async () => {
          order.push("requestChainId");
          if (!connected) throw new Error("Not preauthorized");
          return config.chainId;
        },
      }),
    );
    assert.equal(result.status, "READY");
    assert.deepEqual(order, ["supportedWalletApi", "connect", "requestChainId"]);
  });
});

test("installed WalletAccountV6 path negotiates and simulates through Wallet Standard", async () => {
  const walletRequests: Array<{ readonly type: string; readonly params?: unknown }> = [];
  let connectCalls = 0;
  const prepared: STRK20_CALL_AND_PROOF = {
    call: {
      contract_address: config.poolAddress,
      entry_point: "deposit",
      calldata: ["0x1", "0x2"],
    },
    proof: { data: "", output: [], proof_facts: [] },
  };
  const runtimeWallet = {
    version: "1.0.0",
    name: "Runtime Spike Wallet",
    icon: "data:image/png;base64,AA==",
    chains: ["starknet:SN_MAIN"],
    accounts: [],
    features: {
      "starknet:walletApi": {
        version: "1.0.0",
        walletVersion: "spike",
        id: "runtime-spike-wallet",
        request: async (request: { readonly type: string; readonly params?: unknown }) => {
          walletRequests.push(request);
          if (request.type === "wallet_supportedWalletApi") return ["0.10.3"];
          if (request.type === "wallet_requestChainId") return config.chainId;
          if (request.type === "wallet_strk20PrepareInvoke") return prepared;
          throw new Error(`Unexpected Wallet API request ${request.type}`);
        },
      },
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          connectCalls += 1;
          return { accounts: [{ address: account }] };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => undefined,
      },
      "standard:events": {
        version: "1.0.0",
        on: () => () => undefined,
      },
    },
  } as unknown as WalletWithStarknetFeatures;

  const capability = await inspectWalletCapability(runtimeWallet, config);
  assert.equal(capability.status, "READY");
  if (capability.status !== "READY") return;
  const action = buildDepositAction(validIntent(), config);
  const simulation = await prepareDepositSimulation(capability.account, action);

  assert.equal(connectCalls, 1);
  assert.equal(simulation.status, "SIMULATED");
  assert.deepEqual(
    walletRequests.map((request) => request.type),
    [
      "wallet_supportedWalletApi",
      "wallet_requestChainId",
      "wallet_strk20PrepareInvoke",
    ],
  );
  const prepareRequest = walletRequests.at(-1);
  assert.deepEqual(prepareRequest?.params, { actions: [action], simulate: true });
  assert.equal(
    walletRequests.some((request) => request.type === "wallet_strk20InvokeTransaction"),
    false,
  );
});

test("wallet discovery fails closed when no browser Wallet Standard context exists", async () => {
  const result = await discoverAndInspectWallet(config);
  assert.deepEqual(result, {
    status: "UNAVAILABLE",
    code: "BROWSER_CONTEXT_UNAVAILABLE",
    message: "Wallet discovery requires a browser Wallet Standard context.",
  });
});

test("wallet simulation calls strk20PrepareInvoke(actions, true) and never broadcasts", async () => {
  const action = buildDepositAction(validIntent(), config);
  let prepareCalls = 0;
  let broadcastCalls = 0;
  const prepared: STRK20_CALL_AND_PROOF = {
    call: {
      contract_address: config.poolAddress,
      entry_point: "deposit",
      calldata: ["0x1", "0x2"],
    },
    proof: { data: "", output: [], proof_facts: [] },
  };
  const accountAdapter = {
    address: account,
    async strk20PrepareInvoke(actions: readonly unknown[], simulate: boolean) {
      prepareCalls += 1;
      assert.deepEqual(actions, [action]);
      assert.equal(simulate, true);
      return prepared;
    },
    async strk20InvokeTransaction() {
      broadcastCalls += 1;
      return { transaction_hash: "0xnever" };
    },
  } as unknown as WalletAccountV6Like;

  const result = await prepareDepositSimulation(accountAdapter, action);
  assert.deepEqual(result, {
    status: "SIMULATED",
    simulateFlag: true,
    contractAddress: config.poolAddress,
    entryPoint: "deposit",
    calldataLength: 2,
    proofEmpty: true,
  });
  assert.equal(prepareCalls, 1);
  assert.equal(broadcastCalls, 0);
});

function publicDeposit(
  eventIndex: number,
  amount = 100n,
  depositor = otherAccount,
): PublicDepositObservation {
  const transactionHash = `0x${(0xa0 + eventIndex).toString(16)}` as `0x${string}`;
  return {
    blockNumber: sourceParentBlock,
    blockHash: sourceParentHash,
    timestamp: evaluationTimestamp - 2,
    transactionHash,
    eventIndex,
    eventId: `${sourceParentBlock}:${transactionHash}:${eventIndex}`,
    eventSelector: abi.deposit.selector,
    depositor,
    token,
    amount,
    normalizedFields: {
      depositor,
      token,
      amount: amount.toString(10),
    },
  };
}

test("snapshot hashing is deterministic across input ordering", () => {
  const first = {
    ...validSnapshot(),
    queriedSelectors: [abi.viewingKeySet.selector, abi.deposit.selector],
    blockReferences: [...validSnapshot().blockReferences].reverse(),
    depositObservations: [publicDeposit(2), publicDeposit(1)],
  };
  const second = {
    ...first,
    queriedSelectors: [...first.queriedSelectors].reverse(),
    blockReferences: [...first.blockReferences].reverse(),
    depositObservations: [...first.depositObservations].reverse(),
  };
  assert.equal(hashPublicSnapshot(first), hashPublicSnapshot(second));
  assert.notEqual(
    hashPublicSnapshot(first),
    hashPublicSnapshot({
      ...second,
      depositObservations: [{ ...publicDeposit(1), amount: 101n, normalizedFields: {
        ...publicDeposit(1).normalizedFields,
        amount: "101",
      } }, publicDeposit(2)],
    }),
  );
});

test("fresh complete snapshots validate and engine integration is deterministic", () => {
  const snapshot = {
    ...validSnapshot(),
    depositObservations: [publicDeposit(0)],
  };
  const freshness = validatePublicSnapshot(snapshot, validIntent(), config, abi);
  assert.equal(freshness.sourceAgeSeconds, 1);
  assert.equal(freshness.indexLagSeconds, 1);

  const first = runSpikePreflight({ snapshot, intent: validIntent(), config, abi });
  const second = runSpikePreflight({ snapshot, intent: validIntent(), config, abi });
  assert.deepEqual(first, second);
  assert.equal(first.status, "AVAILABLE");
  if (first.status !== "AVAILABLE") return;
  assert.equal(first.modelVersion, CUTOUT_MODEL.version);
  assert.equal(first.snapshotHash, hashPublicSnapshot(snapshot));
});

test("stale, corrupt, and incomplete snapshots never return LOW or ALLOW", async (t) => {
  await t.test("stale source", () => {
    assertUnavailable(validSnapshot(), "RPC_DATA_STALE", validIntent({
      evaluationTimestamp: evaluationTimestamp + 121,
      deadline: evaluationTimestamp + 3_721,
    }));
  });

  await t.test("RPC head behind source", () => {
    const snapshot = { ...validSnapshot(), rpcHeadBlock: observedBlock - 1 };
    assertUnavailable(snapshot, "RPC_HEAD_INCONSISTENT");
  });

  await t.test("index lag exceeds the frozen freshness limit", () => {
    const rpcHeadTimestamp = evaluationTimestamp + 121;
    const snapshot = {
      ...validSnapshot(),
      rpcHeadTimestamp,
      blockReferences: validSnapshot().blockReferences.map((reference) =>
        reference.blockNumber === rpcHeadBlock
          ? { ...reference, timestamp: rpcHeadTimestamp }
          : reference,
      ),
    };
    assertUnavailable(snapshot, "INDEX_LAG_EXCEEDED");
  });

  await t.test("block hash mismatch", () => {
    const snapshot = { ...validSnapshot(), indexedThroughHash: "0xbad" };
    assertUnavailable(snapshot, "BLOCK_HASH_INCONSISTENT");
  });

  await t.test("broken parent link", () => {
    const snapshot = { ...validSnapshot(), sourceDeclaredParentHash: "0xbad" };
    assertUnavailable(snapshot, "PARENT_LINK_BROKEN");
  });

  await t.test("incomplete event pages", () => {
    const snapshot = { ...validSnapshot(), pagesComplete: false };
    assertUnavailable(snapshot, "SOURCE_INCOMPLETE");
  });

  await t.test("missing required selector", () => {
    const snapshot = { ...validSnapshot(), queriedSelectors: [abi.deposit.selector] };
    assertUnavailable(snapshot, "SOURCE_INCOMPLETE");
  });

  await t.test("unknown retained selector", () => {
    const snapshot = {
      ...validSnapshot(),
      depositObservations: [{ ...publicDeposit(0), eventSelector: "0xdead" }],
    };
    assertUnavailable(snapshot, "UNKNOWN_EVENT_SELECTOR");
  });

  await t.test("missing source-boundary reference", () => {
    const snapshot = {
      ...validSnapshot(),
      blockReferences: validSnapshot().blockReferences.filter(
        (item) => item.blockNumber !== sourceFromBlock,
      ),
    };
    assertUnavailable(snapshot, "SNAPSHOT_INCOMPLETE");
  });

  await t.test("malformed deposit amount", () => {
    const malformed = {
      ...publicDeposit(0),
      amount: (1n << 128n),
      normalizedFields: { ...publicDeposit(0).normalizedFields, amount: (1n << 128n).toString(10) },
    };
    assertUnavailable({ ...validSnapshot(), depositObservations: [malformed] }, "SNAPSHOT_INCOMPLETE");
  });
});

test("bounded RPC ingestion decodes reviewed public events and builds a complete snapshot", async () => {
  const requiredFromTimestamp = evaluationTimestamp - CUTOUT_MODEL.observationSeconds;
  const headers = new Map<number, RpcBlockHeader>([
    [sourceFromBlock, {
      blockNumber: sourceFromBlock,
      blockHash: sourceFromHash,
      parentHash: "0xff",
      timestamp: requiredFromTimestamp - 100,
      status: "ACCEPTED_ON_L2",
    }],
    [sourceParentBlock, {
      blockNumber: sourceParentBlock,
      blockHash: sourceParentHash,
      parentHash: sourceFromHash,
      timestamp: evaluationTimestamp - 2,
      status: "ACCEPTED_ON_L2",
    }],
    [observedBlock, {
      blockNumber: observedBlock,
      blockHash: observedHash,
      parentHash: sourceParentHash,
      timestamp: evaluationTimestamp - 1,
      status: "ACCEPTED_ON_L2",
    }],
    [rpcHeadBlock, {
      blockNumber: rpcHeadBlock,
      blockHash: rpcHeadHash,
      parentHash: observedHash,
      timestamp: evaluationTimestamp,
      status: "ACCEPTED_ON_L2",
    }],
  ]);
  let headCalls = 0;
  const getHeader = (blockNumber: number): RpcBlockHeader => {
    const header = headers.get(blockNumber);
    if (header === undefined) throw new Error(`missing test block ${blockNumber}`);
    return header;
  };
  const rpc: PublicRpc = {
    getChainId: async () => config.chainId,
    getBlockNumber: async () => {
      headCalls += 1;
      return headCalls === 1 ? observedBlock : rpcHeadBlock;
    },
    getBlock: async (blockNumber) => getHeader(blockNumber),
    getBlocks: async (blockNumbers) => blockNumbers.map(getHeader),
    getEvents: async (filter) => {
      const selector = filter.keys[0]?.[0];
      if (selector === abi.deposit.selector) {
        return { events: [rawDepositEvent(getHeader(sourceParentBlock))] };
      }
      if (selector === abi.viewingKeySet.selector) {
        return { events: [rawViewingKeySetEvent(getHeader(observedBlock))] };
      }
      throw new Error("unexpected selector");
    },
    getClassHashAt: async () => abi.classHash,
    getClass: async () => ({ abi: [...fixture.types, ...fixture.events] }),
  };

  const result = await ingestPublicSnapshot({
    rpc,
    config: { ...config, maxEventRangeBlocks: 10 } satisfies StarknetSpikeConfig,
    fixture,
    requiredFromTimestamp,
    sourceFromBlock,
  });
  assert.equal(result.snapshot.depositObservations.length, 1);
  assert.equal(result.snapshot.viewingKeyRegistrationObservations.length, 1);
  assert.equal(result.snapshot.sourceComplete, true);
  assert.equal(result.snapshot.sourceFromHash, sourceFromHash);
  assert.equal(result.snapshot.rpcHeadBlock, rpcHeadBlock);
  assert.equal(result.eventPages, 2);
  const preflight = runSpikePreflight({
    snapshot: result.snapshot,
    intent: validIntent(),
    config,
    abi: result.abi,
  });
  assert.equal(preflight.status, "AVAILABLE");
});
