import assert from "node:assert/strict";
import test from "node:test";

import {
  CUTOUT_MODEL,
  FRESHNESS_POLICY,
  GUARD_POLICY,
  authorizeSubmission,
  createGuardedDepositPlan,
  formatTokenAmount,
  loadPoolAbiFixture,
  mainnetConfig,
  makeFinalExactIntent,
  parseTokenAmount,
  parsePreflightApiResponse,
  requestPreflight,
  reviewPoolAbi,
  simulateGuardedDeposit,
  submitAuthorizedDeposit,
  validateSimulationEvidence,
  validateSingleDepositAction,
  verifyDepositReceipt,
  waitForGuardedReceipt,
  workflowSha256,
} from "../src/index.js";
import type {
  AvailablePreflightApiResponse,
  ExecutionSelection,
  PreflightApiResponse,
  PublicSnapshotBoundary,
  ReceiptExpectation,
  SigningDecisionInput,
  SubmissionAuthorization,
  WalletExecutionAccountV6Like,
  WireCohortQuality,
  WireRecommendation,
  WireShieldIntent,
  WorkflowError,
} from "../src/index.js";

const config = mainnetConfig({
  CHAIN_ID: "0x534e5f4d41494e",
  POOL_ADDRESS: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  RPC_URL: "https://rpc.invalid.example",
});
const fixture = await loadPoolAbiFixture();
const abi = reviewPoolAbi(fixture);
const token = config.tokens[0]!;

const NOW = 2_000_000_000;
const ACCOUNT = "0x123";
const NORMALIZED_ACCOUNT = `0x${"123".padStart(64, "0")}`;
const SNAPSHOT_HASH = `0x${"ab".repeat(32)}` as const;

function snapshot(overrides: Partial<PublicSnapshotBoundary> = {}): PublicSnapshotBoundary {
  return {
    chainId: config.chainId,
    poolAddress: config.poolAddress,
    observedBlock: 100,
    observedBlockHash: "0x100",
    observedTimestamp: NOW - 10,
    indexedThroughBlock: 100,
    indexedThroughHash: "0x100",
    indexedThroughTimestamp: NOW - 10,
    rpcHeadBlock: 101,
    rpcHeadHash: "0x101",
    rpcHeadTimestamp: NOW - 8,
    snapshotHash: SNAPSHOT_HASH,
    engineVersion: CUTOUT_MODEL.version,
    freshnessPolicyVersion: FRESHNESS_POLICY.version,
    guardPolicyVersion: GUARD_POLICY.version,
    ...overrides,
  };
}

function intent(
  overrides: Partial<WireShieldIntent> = {},
): WireShieldIntent {
  return {
    action: "shield",
    chainId: config.chainId,
    account: ACCOUNT,
    token: token.address,
    amount: "100",
    evaluationBlock: 100,
    evaluationTimestamp: NOW,
    flexibility: { mode: "flexible", min: "90", max: "110" },
    deadline: NOW + 600,
    ...overrides,
  };
}

const healthyCohort: WireCohortQuality = {
  existingMatches: 8,
  projectedCohort: 9,
  trafficEvents: 50,
  distinctAddresses: 6,
  distinctTransactions: 9,
  topAddressShare: 1 / 3,
  activeDays: 8,
  maxBurstShare: 0.4,
  healthy: true,
  failures: [],
};

const currentCohort: WireCohortQuality = {
  existingMatches: 0,
  projectedCohort: 1,
  trafficEvents: 50,
  distinctAddresses: 1,
  distinctTransactions: 1,
  topAddressShare: 1,
  activeDays: 1,
  maxBurstShare: 1,
  healthy: false,
  failures: ["THIN_COHORT"],
};

async function response(
  request: WireShieldIntent,
  overrides: Partial<Omit<AvailablePreflightApiResponse, "decisionId">> = {},
): Promise<AvailablePreflightApiResponse> {
  const base: Omit<AvailablePreflightApiResponse, "decisionId"> = {
    status: "AVAILABLE",
    modelVersion: CUTOUT_MODEL.version,
    guardPolicyVersion: GUARD_POLICY.version,
    decision: "WARN",
    riskBand: "MEDIUM",
    signals: [
      { id: "S1", status: "FIRED", summary: "No prior exact amount." },
      { id: "S2", status: "NOT_APPLICABLE", summary: "Not applicable." },
      { id: "S3", status: "NOT_APPLICABLE", summary: "Not applicable." },
      { id: "S4", status: "CLEAR", summary: "No recent registration." },
      { id: "S5", status: "FIRED", summary: "Candidate cohort is thin." },
    ],
    candidateCohort: { existingMatches: 0, projectedCohort: 1 },
    cohortQuality: currentCohort,
    recommendation: {
      kind: "CHANGE_AMOUNT",
      from: "100",
      to: "105",
      absoluteDeviation: "5",
      cohort: healthyCohort,
    },
    freshness: {
      policyVersion: FRESHNESS_POLICY.version,
      maximumSourceAgeSeconds: 120,
      maximumIndexLagSeconds: 120,
      sourceAgeSeconds: 10,
      indexLagSeconds: 2,
      observedBlock: 100,
      indexedThroughBlock: 100,
      rpcHeadBlock: 101,
      sourceComplete: true,
    },
    snapshotHash: SNAPSHOT_HASH,
    nonClaims: ["Candidate cohorts are public evidence only."],
    ...overrides,
  };
  const decisionId = await workflowSha256({
    modelVersion: base.modelVersion,
    guardPolicyVersion: base.guardPolicyVersion,
    snapshotHash: base.snapshotHash,
    intent: request,
    decision: base.decision,
    riskBand: base.riskBand,
    signals: base.signals,
    cohortQuality: base.cohortQuality,
    recommendation: base.recommendation,
  });
  return { ...base, decisionId };
}

async function signingInput(overrides: {
  originalIntent?: WireShieldIntent;
  initialPreflight?: PreflightApiResponse;
  selection?: ExecutionSelection;
  displayedAmount?: string;
  finalIntent?: WireShieldIntent;
  finalPreflight?: PreflightApiResponse;
  snapshot?: PublicSnapshotBoundary;
  wallet?: SigningDecisionInput["wallet"];
  now?: number;
} = {}): Promise<SigningDecisionInput> {
  const original = overrides.originalIntent ?? intent();
  const selected = overrides.selection ?? {
    source: "RECOMMENDATION",
    action: "shield",
    token: token.address,
    amount: "105",
  };
  const boundary = overrides.snapshot ?? snapshot();
  const final = overrides.finalIntent ?? makeFinalExactIntent(original, selected, boundary, NOW);
  return {
    originalIntent: original,
    initialPreflight: overrides.initialPreflight ?? await response(original),
    selection: selected,
    displayedAmount: overrides.displayedAmount ?? selected.amount,
    finalIntent: final,
    finalPreflight: overrides.finalPreflight ?? await response(final, {
      decision: "ALLOW",
      riskBand: "LOW",
      signals: [
        { id: "S1", status: "CLEAR", summary: "Prior exact amounts exist." },
        { id: "S2", status: "NOT_APPLICABLE", summary: "Not applicable." },
        { id: "S3", status: "NOT_APPLICABLE", summary: "Not applicable." },
        { id: "S4", status: "CLEAR", summary: "No recent registration." },
        { id: "S5", status: "CLEAR", summary: "Candidate cohort is healthy." },
      ],
      candidateCohort: { existingMatches: 8, projectedCohort: 9 },
      cohortQuality: healthyCohort,
      recommendation: null,
    }),
    snapshot: boundary,
    wallet: overrides.wallet ?? {
      chainId: config.chainId,
      accountAddress: ACCOUNT,
      selectedApiVersion: "0.10.3",
    },
    now: overrides.now ?? NOW,
  };
}

async function expectWorkflowError(
  operation: () => unknown | Promise<unknown>,
  code: WorkflowError["code"],
): Promise<void> {
  await assert.rejects(async () => operation(), (error: unknown) => {
    assert.equal(error instanceof Error && "code" in error ? error.code : undefined, code);
    return true;
  });
}

test("human token amounts use exact base-unit arithmetic", () => {
  assert.equal(parseTokenAmount("4713.22", 6), 4_713_220_000n);
  assert.equal(formatTokenAmount(4_713_220_000n, 6), "4713.22");
  assert.throws(() => parseTokenAmount("1.0000001", 6));
  assert.throws(() => parseTokenAmount("1e3", 6));
  assert.throws(() => parseTokenAmount("0", 6));
});

test("the action gate accepts exactly one deposit and rejects every broader shape", async (t) => {
  assert.deepEqual(validateSingleDepositAction([{
    type: "deposit",
    token: token.address,
    amount: "0x69",
  }]), {
    type: "deposit",
    token: token.address,
    amount: "0x69",
  });

  for (const [name, value] of [
    ["empty", []],
    ["mixed", [
      { type: "deposit", token: token.address, amount: "0x69" },
      { type: "withdraw", token: token.address, amount: "0x69" },
    ]],
    ["transfer", [{ type: "transfer", token: token.address, amount: "0x69" }]],
    ["withdraw", [{ type: "withdraw", token: token.address, amount: "0x69" }]],
    ["invoke", [{ type: "invoke", calldata: ["0x1"] }]],
    ["arbitrary calldata", [{
      type: "deposit",
      token: token.address,
      amount: "0x69",
      calldata: ["0x1"],
    }]],
  ] as const) {
    await t.test(name, () => {
      assert.throws(
        () => validateSingleDepositAction(value),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "UNSUPPORTED_ACTION",
      );
    });
  }
});

test("a recommendation is bound to final exact preflight, wallet identity, and displayed amount", async () => {
  const plan = await createGuardedDepositPlan(await signingInput(), config);
  assert.equal(plan.status, "VALIDATED");
  assert.equal(plan.selection.source, "RECOMMENDATION");
  assert.equal(plan.action.type, "deposit");
  assert.equal(plan.action.token, token.address);
  assert.equal(plan.action.amount, "0x69");
  assert.equal(plan.displayedAmount, "105");
  assert.equal(plan.decision, "ALLOW");
  assert.equal(plan.warningAcknowledgementRequired, false);
});

test("original amount remains selectable without fabricating a recommendation", async () => {
  const original = intent();
  const selected: ExecutionSelection = {
    source: "ORIGINAL",
    action: "shield",
    token: token.address,
    amount: "100",
  };
  const final = makeFinalExactIntent(original, selected, snapshot(), NOW);
  const plan = await createGuardedDepositPlan(await signingInput({
    originalIntent: original,
    selection: selected,
    displayedAmount: "100",
    finalIntent: final,
    finalPreflight: await response(final, { recommendation: null }),
  }), config);
  assert.equal(plan.selection.source, "ORIGINAL");
  assert.equal(plan.action.amount, "0x64");
});

test("guard validation fails closed for altered intent, evidence, recommendation, or wallet state", async (t) => {
  await t.test("invalid bounds", async () => {
    await expectWorkflowError(
      async () => createGuardedDepositPlan(await signingInput({
        originalIntent: intent({ flexibility: { mode: "flexible", min: "101", max: "99" } }),
      }), config),
      "INVALID_FLEXIBILITY",
    );
  });

  await t.test("recommendation outside bounds", async () => {
    const original = intent({ flexibility: { mode: "flexible", min: "95", max: "102" } });
    const recommendation: WireRecommendation = {
      kind: "CHANGE_AMOUNT",
      from: "100",
      to: "105",
      absoluteDeviation: "5",
      cohort: healthyCohort,
    };
    await expectWorkflowError(
      async () => createGuardedDepositPlan(await signingInput({
        originalIntent: original,
        initialPreflight: await response(original, { recommendation }),
      }), config),
      "RECOMMENDATION_OUT_OF_BOUNDS",
    );
  });

  await t.test("recommendation changes token", async () => {
    const otherToken = config.tokens[1];
    if (otherToken === undefined) throw new Error("missing second token");
    await expectWorkflowError(
      async () => createGuardedDepositPlan(await signingInput({
        selection: {
          source: "RECOMMENDATION",
          action: "shield",
          token: otherToken.address,
          amount: "105",
        },
      }), config),
      "RECOMMENDATION_MISMATCH",
    );
  });

  await t.test("unsupported action", async () => {
    const input = await signingInput();
    const changed = {
      ...input,
      selection: { ...input.selection, action: "withdraw" },
    } as unknown as SigningDecisionInput;
    await expectWorkflowError(() => createGuardedDepositPlan(changed, config), "UNSUPPORTED_ACTION");
  });

  await t.test("displayed amount mismatch", async () => {
    await expectWorkflowError(
      async () => createGuardedDepositPlan(await signingInput({ displayedAmount: "104" }), config),
      "DISPLAYED_AMOUNT_MISMATCH",
    );
  });

  await t.test("stale preflight", async () => {
    await expectWorkflowError(
      async () => createGuardedDepositPlan(await signingInput({ now: NOW + 121 }), config),
      "STALE_PREFLIGHT",
    );
  });

  await t.test("snapshot hash mismatch", async () => {
    const original = intent();
    const differentHash = `0x${"cd".repeat(32)}` as const;
    await expectWorkflowError(
      async () => createGuardedDepositPlan(await signingInput({
        originalIntent: original,
        initialPreflight: await response(original, { snapshotHash: differentHash }),
      }), config),
      "SNAPSHOT_HASH_MISMATCH",
    );
  });

  await t.test("engine version mismatch", async () => {
    const original = intent();
    await expectWorkflowError(
      async () => createGuardedDepositPlan(await signingInput({
        originalIntent: original,
        initialPreflight: await response(original, { modelVersion: "CUTOUT-v9" }),
      }), config),
      "MODEL_VERSION_MISMATCH",
    );
  });

  await t.test("guard policy mismatch", async () => {
    const original = intent();
    await expectWorkflowError(
      async () => createGuardedDepositPlan(await signingInput({
        originalIntent: original,
        initialPreflight: await response(original, { guardPolicyVersion: "GUARD_POLICY-v9" }),
      }), config),
      "GUARD_POLICY_MISMATCH",
    );
  });

  await t.test("decision ID mismatch", async () => {
    const original = intent();
    const preflight = await response(original);
    await expectWorkflowError(
      async () => createGuardedDepositPlan(await signingInput({
        originalIntent: original,
        initialPreflight: { ...preflight, decisionId: `0x${"00".repeat(32)}` },
      }), config),
      "DECISION_ID_MISMATCH",
    );
  });

  await t.test("wallet API below 0.10.3", async () => {
    await expectWorkflowError(
      async () => createGuardedDepositPlan(await signingInput({
        wallet: { chainId: config.chainId, accountAddress: ACCOUNT, selectedApiVersion: "0.7.2" },
      }), config),
      "UNSUPPORTED_WALLET_API",
    );
  });

  await t.test("wallet on wrong network", async () => {
    await expectWorkflowError(
      async () => createGuardedDepositPlan(await signingInput({
        wallet: { chainId: "0x534e5f5345504f4c4941", accountAddress: ACCOUNT, selectedApiVersion: "0.10.3" },
      }), config),
      "WALLET_NETWORK_MISMATCH",
    );
  });

  await t.test("wallet account changed", async () => {
    await expectWorkflowError(
      async () => createGuardedDepositPlan(await signingInput({
        wallet: { chainId: config.chainId, accountAddress: "0x456", selectedApiVersion: "0.10.3" },
      }), config),
      "ACCOUNT_MISMATCH",
    );
  });

  await t.test("DENY never produces a wallet plan", async () => {
    const input = await signingInput();
    const denied = await response(input.finalIntent, { decision: "DENY", riskBand: "HIGH" });
    await expectWorkflowError(
      () => createGuardedDepositPlan({ ...input, finalPreflight: denied }, config),
      "GUARD_DENIED",
    );
  });
});

test("submission authorization requires matching simulation, explicit approval, and fresh evidence", async (t) => {
  const plan = await createGuardedDepositPlan(await signingInput(), config);
  const simulation = validateSimulationEvidence(plan, {
    status: "SIMULATED",
    simulateFlag: true,
    contractAddress: config.poolAddress,
    entryPoint: "apply_actions",
    calldataLength: 16,
    proofEmpty: true,
  });
  const authorization = authorizeSubmission({
    simulated: simulation,
    explicitUserApproval: true,
    warningAcknowledged: false,
    now: NOW,
  });
  assert.equal(authorization.status, "AUTHORIZED");
  assert.equal(authorization.explicitUserApproval, true);

  await t.test("simulation mismatch", () => {
    assert.throws(
      () => validateSimulationEvidence(plan, {
        status: "SIMULATED",
        simulateFlag: true,
        contractAddress: "0x999",
        entryPoint: "apply_actions",
        calldataLength: 16,
        proofEmpty: true,
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "SIMULATION_MISMATCH",
    );
  });
  await t.test("no explicit approval", () => {
    assert.throws(
      () => authorizeSubmission({
        simulated: simulation,
        explicitUserApproval: false,
        warningAcknowledged: false,
        now: NOW,
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "USER_APPROVAL_REQUIRED",
    );
  });
  await t.test("stale before confirmation", () => {
    assert.throws(
      () => authorizeSubmission({
        simulated: simulation,
        explicitUserApproval: true,
        warningAcknowledged: false,
        now: NOW + 121,
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "STALE_PREFLIGHT",
    );
  });
});

test("wallet adapter simulates before an explicitly authorized single-action submission", async () => {
  const plan = await createGuardedDepositPlan(await signingInput(), config);
  let prepareCalls = 0;
  let submissionCalls = 0;
  let receiptCalls = 0;
  const account: WalletExecutionAccountV6Like = {
    address: NORMALIZED_ACCOUNT,
    async strk20PrepareInvoke(actions, simulate) {
      prepareCalls += 1;
      assert.equal(simulate, true);
      assert.deepEqual(actions, [plan.action]);
      return {
        call: {
          contract_address: config.poolAddress,
          entry_point: "apply_actions",
          calldata: Array.from({ length: 16 }, (_, index) => `0x${index.toString(16)}`),
        },
        proof: { data: "", output: [], proof_facts: [] },
      };
    },
    async strk20InvokeTransaction(actions) {
      submissionCalls += 1;
      assert.deepEqual(actions, [plan.action]);
      return { transaction_hash: "0xabc" };
    },
  };
  const receiptProvider = {
    async waitForTransaction(transactionHash: string) {
      receiptCalls += 1;
      assert.equal(transactionHash, "0xabc");
      return { value: receipt() };
    },
  };

  const simulated = await simulateGuardedDeposit(account, plan, NOW);
  assert.equal(simulated.status, "SIMULATED");
  assert.equal(prepareCalls, 1);
  assert.equal(submissionCalls, 0);
  if (simulated.status !== "SIMULATED") return;

  const authorization = authorizeSubmission({
    simulated,
    explicitUserApproval: true,
    warningAcknowledged: false,
    now: NOW,
  });
  const submitted = await submitAuthorizedDeposit(account, authorization);
  assert.deepEqual(submitted, { status: "SUBMITTED", transactionHash: "0xabc" });
  assert.equal(submissionCalls, 1);

  const received = await waitForGuardedReceipt(receiptProvider, "0xabc");
  assert.equal(received.status, "RECEIVED");
  assert.equal(receiptCalls, 1);
});

test("independent public receipt lookup fails closed when RPC verification is unavailable", async () => {
  const result = await waitForGuardedReceipt({
    async waitForTransaction(transactionHash: string) {
      assert.equal(transactionHash, "0xabc");
      throw new Error("public RPC unavailable");
    },
  }, "0xabc");

  assert.equal(result.status, "FAILED");
  if (result.status !== "FAILED") return;
  assert.equal(result.code, "RECEIPT_UNAVAILABLE");
  assert.match(result.message, /public RPC unavailable/);
});

test("no wallet method is called when guard, simulation, or approval validation fails", async (t) => {
  const plan = await createGuardedDepositPlan(await signingInput(), config);
  let prepareCalls = 0;
  let submissionCalls = 0;
  const account: WalletExecutionAccountV6Like = {
    address: NORMALIZED_ACCOUNT,
    async strk20PrepareInvoke() {
      prepareCalls += 1;
      throw new Error("must not be called");
    },
    async strk20InvokeTransaction() {
      submissionCalls += 1;
      return { transaction_hash: "0xabc" };
    },
  };

  await t.test("tampered plan", async () => {
    await expectWorkflowError(
      () => simulateGuardedDeposit(account, { ...plan, displayedAmount: "106" }, NOW),
      "INVALID_INTENT",
    );
    assert.equal(prepareCalls, 0);
  });
  await t.test("stale plan", async () => {
    await expectWorkflowError(
      () => simulateGuardedDeposit(account, plan, NOW + 121),
      "STALE_PREFLIGHT",
    );
    assert.equal(prepareCalls, 0);
  });
  await t.test("fabricated authorization", async () => {
    const invalid = {
      status: "AUTHORIZED",
      explicitUserApproval: false,
      action: plan.action,
    } as unknown as SubmissionAuthorization;
    await expectWorkflowError(
      () => submitAuthorizedDeposit(account, invalid),
      "USER_APPROVAL_REQUIRED",
    );
    assert.equal(submissionCalls, 0);
  });
});

test("wallet rejection and simulation failure remain explicit non-success states", async () => {
  const plan = await createGuardedDepositPlan(await signingInput(), config);
  let submissionCalls = 0;
  const simulationFailure: WalletExecutionAccountV6Like = {
    async strk20PrepareInvoke() {
      throw new Error("simulation unavailable");
    },
  };
  const failedSimulation = await simulateGuardedDeposit(simulationFailure, plan, NOW);
  assert.deepEqual(failedSimulation, {
    status: "FAILED",
    code: "WALLET_SIMULATION_FAILED",
    message: "Wallet simulation failed: simulation unavailable",
  });

  const simulated = validateSimulationEvidence(plan, {
    status: "SIMULATED",
    simulateFlag: true,
    contractAddress: config.poolAddress,
    entryPoint: "apply_actions",
    calldataLength: 16,
    proofEmpty: true,
  });
  const authorization = authorizeSubmission({
    simulated,
    explicitUserApproval: true,
    warningAcknowledged: false,
    now: NOW,
  });
  const rejecting: WalletExecutionAccountV6Like = {
    async strk20PrepareInvoke() {
      throw new Error("not used");
    },
    async strk20InvokeTransaction() {
      submissionCalls += 1;
      throw Object.assign(new Error("User rejected request"), { code: 4001 });
    },
  };
  const rejected = await submitAuthorizedDeposit(rejecting, authorization);
  assert.equal(rejected.status, "FAILED");
  if (rejected.status === "FAILED") assert.equal(rejected.code, "USER_REJECTED");
  assert.equal(submissionCalls, 1);
});

test("preflight client preserves the single fail-closed API contract", async (t) => {
  const request = intent();
  const available = await response(request);
  let observedUrl = "";
  let observedBody = "";
  const received = await requestPreflight(async (url, init) => {
    observedUrl = url;
    observedBody = init.body;
    assert.equal(init.method, "POST");
    assert.equal(init.cache, "no-store");
    return { status: 200, json: async () => available };
  }, request);
  assert.deepEqual(received, available);
  assert.equal(observedUrl, "/api/preflight");
  assert.deepEqual(JSON.parse(observedBody), request);

  await t.test("backend unavailable", async () => {
    const result = await requestPreflight(async () => {
      throw new Error("connection refused");
    }, request);
    assert.equal(result.status, "CLIENT_UNAVAILABLE");
    if (result.status === "CLIENT_UNAVAILABLE") {
      assert.equal(result.code, "BACKEND_UNAVAILABLE");
      assert.equal("decision" in result, false);
    }
  });

  await t.test("malformed body", async () => {
    const result = await requestPreflight(async () => ({
      status: 200,
      json: async () => ({ status: "AVAILABLE", decision: "ALLOW" }),
    }), request);
    assert.equal(result.status, "CLIENT_UNAVAILABLE");
    if (result.status === "CLIENT_UNAVAILABLE") assert.equal(result.code, "INVALID_RESPONSE");
  });

  await t.test("HTTP error cannot carry AVAILABLE", async () => {
    const result = await requestPreflight(async () => ({
      status: 503,
      json: async () => available,
    }), request);
    assert.equal(result.status, "CLIENT_UNAVAILABLE");
  });

  await t.test("operational API failure has no decision or band", async () => {
    const unavailable = {
      status: "NO_CONFIDENT_RECOMMENDATION",
      modelVersion: CUTOUT_MODEL.version,
      guardPolicyVersion: GUARD_POLICY.version,
      error: { code: "INDEX_LAG", message: "Indexer is behind." },
      snapshotHash: SNAPSHOT_HASH,
      decisionId: `0x${"cd".repeat(32)}`,
      nonClaims: ["Candidate cohorts are public evidence only."],
    } as const;
    assert.deepEqual(parsePreflightApiResponse(unavailable), unavailable);
    const result = await requestPreflight(async () => ({
      status: 503,
      json: async () => unavailable,
    }), request);
    assert.deepEqual(result, unavailable);
    assert.equal("decision" in result, false);
    assert.equal("riskBand" in result, false);
  });
});

function receiptExpectation(overrides: Partial<ReceiptExpectation> = {}): ReceiptExpectation {
  return {
    transactionHash: "0xabc",
    chainId: config.chainId,
    poolAddress: config.poolAddress,
    depositSelector: abi.deposit.selector,
    token: token.address,
    amount: "105",
    account: ACCOUNT,
    observedSnapshotHash: SNAPSHOT_HASH,
    engineVersion: CUTOUT_MODEL.version,
    guardPolicyVersion: GUARD_POLICY.version,
    decision: "ALLOW",
    recommendationStatus: "ACCEPTED",
    timestamp: NOW + 30,
    ...overrides,
  };
}

function receipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transaction_hash: "0xabc",
    block_number: 105,
    block_hash: "0x105",
    finality_status: "ACCEPTED_ON_L2",
    execution_status: "SUCCEEDED",
    events: [{
      from_address: config.poolAddress,
      keys: [abi.deposit.selector, ACCOUNT, token.address],
      data: ["0x69"],
    }],
    ...overrides,
  };
}

test("receipt verification creates a deterministic versioned public artifact", async () => {
  const first = await verifyDepositReceipt(receipt(), receiptExpectation());
  const second = await verifyDepositReceipt(structuredClone(receipt()), receiptExpectation());
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, "CUTOUT_RECEIPT-v1");
  assert.equal(first.transactionHash, "0xabc");
  assert.equal(first.pool, config.poolAddress);
  assert.equal(first.token, token.address);
  assert.equal(first.amount, "105");
  assert.equal(first.account, NORMALIZED_ACCOUNT);
  assert.match(first.receiptId, /^0x[0-9a-f]{64}$/);
  assert.equal("privateKey" in first, false);
  assert.equal("viewingKey" in first, false);
  assert.equal("note" in first, false);
  assert.equal("proof" in first, false);
});

test("receipt verification fails closed for every expected-action mismatch", async (t) => {
  const cases: ReadonlyArray<readonly [string, Record<string, unknown>, ReceiptExpectation]> = [
    ["reverted", receipt({ execution_status: "REVERTED" }), receiptExpectation()],
    ["not included", receipt({ finality_status: "PRE_CONFIRMED" }), receiptExpectation()],
    ["transaction hash", receipt({ transaction_hash: "0xdef" }), receiptExpectation()],
    ["token", receipt(), receiptExpectation({ token: config.tokens[1]?.address ?? "0x999" })],
    ["amount", receipt(), receiptExpectation({ amount: "106" })],
    ["pool", receipt(), receiptExpectation({ poolAddress: "0x999" })],
    ["depositor", receipt(), receiptExpectation({ account: "0x456" })],
    ["missing Deposit", receipt({ events: [] }), receiptExpectation()],
    ["duplicate Deposit", receipt({
      events: [
        { from_address: config.poolAddress, keys: [abi.deposit.selector, ACCOUNT, token.address], data: ["0x69"] },
        { from_address: config.poolAddress, keys: [abi.deposit.selector, ACCOUNT, token.address], data: ["0x69"] },
      ],
    }), receiptExpectation()],
  ];
  for (const [name, candidate, expectation] of cases) {
    await t.test(name, async () => {
      await expectWorkflowError(
        () => verifyDepositReceipt(candidate, expectation),
        "RECEIPT_MISMATCH",
      );
    });
  }
});
