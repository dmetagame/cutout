import { CUTOUT_MODEL } from "../engine/constants.js";
import type { Decision } from "../engine/types.js";
import type {
  AvailablePreflightApiResponse,
  PreflightApiResponse,
  WireShieldIntent,
} from "../api/types.js";
import { buildDepositAction, validateShieldIntent } from "../starknet/actions.js";
import type { StarknetSpikeConfig } from "../starknet/config.js";
import { normalizeAddress, normalizeFelt } from "../starknet/felt.js";
import { FRESHNESS_POLICY, GUARD_POLICY, guardDecisionForBand } from "../starknet/policies.js";
import type { SpikeShieldIntent } from "../starknet/types.js";
import { absoluteAmountDifference, parseBaseUnitAmount } from "./amounts.js";
import { workflowSha256 } from "./canonical.js";
import type {
  DepositAction,
  ExecutionSelection,
  GuardedDepositPlan,
  PublicSnapshotBoundary,
  SigningDecisionInput,
  SimulatedDepositPlan,
  SubmissionAuthorization,
  WalletSimulationEvidence,
} from "./types.js";
import { WorkflowError } from "./types.js";

const REQUIRED_WALLET_API_VERSION = "0.10.3";
const INTENT_KEYS = new Set([
  "action",
  "chainId",
  "account",
  "token",
  "amount",
  "evaluationBlock",
  "evaluationTimestamp",
  "flexibility",
  "deadline",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseIntent(value: unknown): {
  readonly action: "shield";
  readonly chainId: string;
  readonly account: string;
  readonly token: string;
  readonly amount: bigint;
  readonly evaluationBlock: number;
  readonly evaluationTimestamp: number;
  readonly flexibility:
    | { readonly mode: "exact" }
    | { readonly mode: "flexible"; readonly min: bigint; readonly max: bigint };
  readonly deadline: number;
} {
  if (!isRecord(value) || !hasOnlyKeys(value, INTENT_KEYS)) {
    throw new WorkflowError("INVALID_INTENT", "Request must contain exactly one typed shield intent.");
  }
  if (value.action !== "shield") {
    throw new WorkflowError("UNSUPPORTED_ACTION", "Only one STRK20 shield/deposit action is supported.");
  }
  if (
    typeof value.chainId !== "string" ||
    typeof value.account !== "string" ||
    typeof value.token !== "string" ||
    typeof value.evaluationBlock !== "number" ||
    typeof value.evaluationTimestamp !== "number" ||
    typeof value.deadline !== "number" ||
    !Number.isSafeInteger(value.evaluationBlock) ||
    !Number.isSafeInteger(value.evaluationTimestamp) ||
    !Number.isSafeInteger(value.deadline)
  ) {
    throw new WorkflowError("INVALID_INTENT", "Shield intent fields have invalid types.");
  }
  const amount = parseBaseUnitAmount(value.amount);
  if (!isRecord(value.flexibility) || typeof value.flexibility.mode !== "string") {
    throw new WorkflowError("INVALID_FLEXIBILITY", "Flexibility constraints are required.");
  }
  let flexibility:
    | { readonly mode: "exact" }
    | { readonly mode: "flexible"; readonly min: bigint; readonly max: bigint };
  if (value.flexibility.mode === "exact") {
    if (!hasOnlyKeys(value.flexibility, new Set(["mode"]))) {
      throw new WorkflowError("INVALID_FLEXIBILITY", "Exact flexibility has an invalid shape.");
    }
    flexibility = { mode: "exact" };
  } else if (
    value.flexibility.mode === "flexible" &&
    hasOnlyKeys(value.flexibility, new Set(["mode", "min", "max"]))
  ) {
    flexibility = {
      mode: "flexible",
      min: parseBaseUnitAmount(value.flexibility.min, "flexibility.min"),
      max: parseBaseUnitAmount(value.flexibility.max, "flexibility.max"),
    };
  } else {
    throw new WorkflowError("INVALID_FLEXIBILITY", "Flexibility constraints have an invalid shape.");
  }
  return {
    action: "shield",
    chainId: value.chainId,
    account: value.account,
    token: value.token,
    amount,
    evaluationBlock: value.evaluationBlock,
    evaluationTimestamp: value.evaluationTimestamp,
    flexibility,
    deadline: value.deadline,
  };
}

function versionParts(value: string): readonly number[] | undefined {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")];
}

function walletApiSupported(value: string): boolean {
  const actual = versionParts(value);
  const required = versionParts(REQUIRED_WALLET_API_VERSION);
  if (actual === undefined || required === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    const difference = (actual[index] ?? 0) - (required[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new WorkflowError("STALE_PREFLIGHT", `${field} is missing or invalid.`);
  }
  return value;
}

function normalizeSnapshotHash(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) {
    throw new WorkflowError("SNAPSHOT_HASH_MISMATCH", `${field} is not a canonical snapshot hash.`);
  }
  return value as `0x${string}`;
}

function checkedIntent(
  value: unknown,
  config: StarknetSpikeConfig,
): { readonly wire: WireShieldIntent; readonly normalized: SpikeShieldIntent } {
  try {
    const parsed = parseIntent(value);
    const intent = validateShieldIntent(parsed, config);
    return {
      wire: {
        action: "shield",
        chainId: parsed.chainId,
        account: parsed.account,
        token: parsed.token,
        amount: parsed.amount.toString(10),
        evaluationBlock: parsed.evaluationBlock,
        evaluationTimestamp: parsed.evaluationTimestamp,
        flexibility: parsed.flexibility.mode === "exact"
          ? { mode: "exact" }
          : {
              mode: "flexible",
              min: parsed.flexibility.min.toString(10),
              max: parsed.flexibility.max.toString(10),
            },
        deadline: parsed.deadline,
      },
      normalized: intent,
    };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "INVALID_INTENT";
    if (code === "UNSUPPORTED_ACTION") {
      throw new WorkflowError("UNSUPPORTED_ACTION", "Only one STRK20 shield/deposit action is supported.");
    }
    if (code === "UNSUPPORTED_TOKEN") {
      throw new WorkflowError("UNSUPPORTED_TOKEN", "The selected token is not configured for Cutout.");
    }
    if (code === "INVALID_AMOUNT" || code === "INVALID_AMOUNT_BOUNDS") {
      throw new WorkflowError("INVALID_FLEXIBILITY", error instanceof Error ? error.message : String(error));
    }
    throw new WorkflowError("INVALID_INTENT", error instanceof Error ? error.message : String(error));
  }
}

function validateBoundary(
  snapshot: PublicSnapshotBoundary,
  config: StarknetSpikeConfig,
): PublicSnapshotBoundary {
  if (snapshot === null || typeof snapshot !== "object") {
    throw new WorkflowError("PREFLIGHT_UNAVAILABLE", "Canonical snapshot metadata is unavailable.");
  }
  if (normalizeFelt(snapshot.chainId, "snapshot chain") !== config.chainId) {
    throw new WorkflowError("SNAPSHOT_HASH_MISMATCH", "Snapshot chain does not match Cutout configuration.");
  }
  if (normalizeAddress(snapshot.poolAddress, "snapshot pool") !== config.poolAddress) {
    throw new WorkflowError("SNAPSHOT_HASH_MISMATCH", "Snapshot pool does not match Cutout configuration.");
  }
  normalizeFelt(snapshot.observedBlockHash, "observed block hash");
  normalizeFelt(snapshot.indexedThroughHash, "indexed-through hash");
  normalizeFelt(snapshot.rpcHeadHash, "RPC head hash");
  normalizeSnapshotHash(snapshot.snapshotHash, "snapshot hash");
  const observedBlock = integer(snapshot.observedBlock, "observed block");
  const indexedThroughBlock = integer(snapshot.indexedThroughBlock, "indexed-through block");
  const rpcHeadBlock = integer(snapshot.rpcHeadBlock, "RPC head block");
  const observedTimestamp = integer(snapshot.observedTimestamp, "observed timestamp");
  const indexedThroughTimestamp = integer(snapshot.indexedThroughTimestamp, "indexed-through timestamp");
  const rpcHeadTimestamp = integer(snapshot.rpcHeadTimestamp, "RPC head timestamp");
  if (
    observedBlock > indexedThroughBlock ||
    indexedThroughBlock > rpcHeadBlock ||
    observedTimestamp > indexedThroughTimestamp ||
    indexedThroughTimestamp > rpcHeadTimestamp
  ) {
    throw new WorkflowError("STALE_PREFLIGHT", "Canonical snapshot block or timestamp order is inconsistent.");
  }
  if (snapshot.engineVersion !== CUTOUT_MODEL.version) {
    throw new WorkflowError("MODEL_VERSION_MISMATCH", "Snapshot engine version is not CUTOUT-v1.3.");
  }
  if (snapshot.freshnessPolicyVersion !== FRESHNESS_POLICY.version) {
    throw new WorkflowError("MODEL_VERSION_MISMATCH", "Snapshot freshness policy version is inconsistent.");
  }
  if (snapshot.guardPolicyVersion !== GUARD_POLICY.version) {
    throw new WorkflowError("GUARD_POLICY_MISMATCH", "Snapshot guard policy version is inconsistent.");
  }
  return snapshot;
}

function validateFreshness(
  response: AvailablePreflightApiResponse,
  snapshot: PublicSnapshotBoundary,
  now: number,
): void {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new WorkflowError("STALE_PREFLIGHT", "Current time is invalid.");
  }
  const freshness = response.freshness;
  if (
    freshness.policyVersion !== FRESHNESS_POLICY.version ||
    freshness.maximumSourceAgeSeconds !== FRESHNESS_POLICY.maximumSourceAgeSeconds ||
    freshness.maximumIndexLagSeconds !== FRESHNESS_POLICY.maximumIndexLagSeconds ||
    freshness.sourceComplete !== true
  ) {
    throw new WorkflowError("STALE_PREFLIGHT", "Preflight freshness policy metadata is inconsistent.");
  }
  if (
    freshness.observedBlock !== snapshot.observedBlock ||
    freshness.indexedThroughBlock !== snapshot.indexedThroughBlock ||
    freshness.rpcHeadBlock !== snapshot.rpcHeadBlock
  ) {
    throw new WorkflowError("SNAPSHOT_HASH_MISMATCH", "Preflight block metadata does not match the reviewed snapshot.");
  }
  const expectedIndexLag = snapshot.rpcHeadTimestamp - snapshot.indexedThroughTimestamp;
  const currentSourceAge = now - snapshot.indexedThroughTimestamp;
  if (
    freshness.sourceAgeSeconds < 0 ||
    freshness.sourceAgeSeconds > FRESHNESS_POLICY.maximumSourceAgeSeconds ||
    freshness.indexLagSeconds !== expectedIndexLag ||
    freshness.indexLagSeconds < 0 ||
    freshness.indexLagSeconds > FRESHNESS_POLICY.maximumIndexLagSeconds ||
    currentSourceAge < 0 ||
    currentSourceAge > FRESHNESS_POLICY.maximumSourceAgeSeconds
  ) {
    throw new WorkflowError("STALE_PREFLIGHT", "Preflight evidence is no longer fresh enough for a wallet call.");
  }
}

function decisionPayload(intent: WireShieldIntent, response: AvailablePreflightApiResponse): unknown {
  return {
    modelVersion: response.modelVersion,
    guardPolicyVersion: response.guardPolicyVersion,
    snapshotHash: response.snapshotHash,
    intent,
    decision: response.decision,
    riskBand: response.riskBand,
    signals: response.signals,
    cohortQuality: response.cohortQuality,
    recommendation: response.recommendation,
  };
}

async function validateAvailablePreflight(
  response: PreflightApiResponse,
  intent: WireShieldIntent,
  snapshot: PublicSnapshotBoundary,
  now: number,
): Promise<AvailablePreflightApiResponse> {
  if (response.status !== "AVAILABLE") {
    throw new WorkflowError(
      "PREFLIGHT_UNAVAILABLE",
      `Cutout evidence is unavailable: ${response.error.code}.`,
    );
  }
  if (response.modelVersion !== CUTOUT_MODEL.version || response.modelVersion !== snapshot.engineVersion) {
    throw new WorkflowError("MODEL_VERSION_MISMATCH", "Preflight model version is inconsistent.");
  }
  if (
    response.guardPolicyVersion !== GUARD_POLICY.version ||
    response.guardPolicyVersion !== snapshot.guardPolicyVersion
  ) {
    throw new WorkflowError("GUARD_POLICY_MISMATCH", "Preflight guard policy version is inconsistent.");
  }
  if (guardDecisionForBand(response.riskBand) !== response.decision) {
    throw new WorkflowError("GUARD_POLICY_MISMATCH", "Preflight band and guard decision disagree.");
  }
  if (normalizeSnapshotHash(response.snapshotHash, "preflight snapshot hash") !== snapshot.snapshotHash) {
    throw new WorkflowError("SNAPSHOT_HASH_MISMATCH", "Preflight used a different canonical snapshot. Refresh and try again.");
  }
  validateFreshness(response, snapshot, now);
  const expectedDecisionId = await workflowSha256(decisionPayload(intent, response));
  if (expectedDecisionId !== response.decisionId) {
    throw new WorkflowError("DECISION_ID_MISMATCH", "Preflight decision ID does not match its evidence and intent.");
  }
  return response;
}

function insideBounds(intent: WireShieldIntent, amount: bigint): boolean {
  if (intent.flexibility.mode === "exact") return amount === BigInt(intent.amount);
  return amount >= BigInt(intent.flexibility.min) && amount <= BigInt(intent.flexibility.max);
}

function validateSelection(
  intent: WireShieldIntent,
  response: AvailablePreflightApiResponse,
  selection: ExecutionSelection,
): bigint {
  if (selection.action !== "shield") {
    throw new WorkflowError("UNSUPPORTED_ACTION", "Selection must remain a shield/deposit action.");
  }
  if (
    normalizeAddress(selection.token, "selected token") !==
    normalizeAddress(intent.token, "intent token")
  ) {
    throw new WorkflowError("RECOMMENDATION_MISMATCH", "Selection changed the requested token.");
  }
  const amount = parseBaseUnitAmount(selection.amount, "selected amount");
  if (!insideBounds(intent, amount)) {
    throw new WorkflowError("RECOMMENDATION_OUT_OF_BOUNDS", "Selected amount is outside the user's permitted range.");
  }
  if (selection.source === "ORIGINAL") {
    if (amount !== BigInt(intent.amount)) {
      throw new WorkflowError("RECOMMENDATION_MISMATCH", "Original selection does not equal the proposed amount.");
    }
    return amount;
  }
  const recommendation = response.recommendation;
  if (recommendation === null || recommendation.kind !== "CHANGE_AMOUNT") {
    throw new WorkflowError("RECOMMENDATION_UNAVAILABLE", "No permitted amount recommendation is available.");
  }
  const recommended = parseBaseUnitAmount(recommendation.to, "recommended amount");
  if (
    parseBaseUnitAmount(recommendation.from, "recommendation source amount") !== BigInt(intent.amount) ||
    recommended !== amount ||
    parseBaseUnitAmount(recommendation.absoluteDeviation, "recommendation deviation") !==
      absoluteAmountDifference(recommended, BigInt(intent.amount)) ||
    recommendation.cohort.healthy !== true
  ) {
    throw new WorkflowError("RECOMMENDATION_MISMATCH", "Recommendation evidence does not match the selected amount.");
  }
  return amount;
}

function validateWallet(
  input: SigningDecisionInput["wallet"],
  intent: WireShieldIntent,
  config: StarknetSpikeConfig,
): void {
  if (!walletApiSupported(input.selectedApiVersion)) {
    throw new WorkflowError(
      "UNSUPPORTED_WALLET_API",
      `Wallet API ${REQUIRED_WALLET_API_VERSION} or newer is required.`,
    );
  }
  if (normalizeFelt(input.chainId, "wallet chain") !== config.chainId) {
    throw new WorkflowError("WALLET_NETWORK_MISMATCH", "Wallet is not connected to Starknet mainnet.");
  }
  if (
    normalizeAddress(input.accountAddress, "wallet account") !==
    normalizeAddress(intent.account, "intent account")
  ) {
    throw new WorkflowError("ACCOUNT_MISMATCH", "Connected wallet account changed after preflight.");
  }
}

function actionBinding(plan: Pick<GuardedDepositPlan,
  "chainId" | "poolAddress" | "account" | "action" | "snapshotHash" | "decisionId"
>): string {
  return [
    plan.chainId,
    plan.poolAddress,
    plan.account,
    plan.action.type,
    plan.action.token,
    plan.action.amount,
    plan.snapshotHash,
    plan.decisionId,
  ].join(":");
}

export function validateSingleDepositAction(
  value: unknown,
  expected?: { readonly token: string; readonly amount: string },
): DepositAction {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new WorkflowError("UNSUPPORTED_ACTION", "Exactly one STRK20 deposit action is required.");
  }
  const candidate = value[0];
  if (
    !isRecord(candidate) ||
    Object.keys(candidate).sort().join(",") !== "amount,token,type" ||
    candidate.type !== "deposit"
  ) {
    throw new WorkflowError(
      "UNSUPPORTED_ACTION",
      "Transfer, withdraw, invoke, mixed actions, and arbitrary calldata are unsupported.",
    );
  }
  let token: string;
  let amount: string;
  try {
    token = normalizeAddress(candidate.token, "deposit token");
    amount = normalizeFelt(candidate.amount, "deposit amount");
  } catch (error) {
    throw new WorkflowError(
      typeof candidate.token === "string" ? "INVALID_AMOUNT" : "UNSUPPORTED_TOKEN",
      error instanceof Error ? error.message : String(error),
    );
  }
  const amountValue = BigInt(amount);
  if (amountValue <= 0n || amountValue >= (1n << 128n)) {
    throw new WorkflowError("INVALID_AMOUNT", "Deposit amount must fit a positive u128.");
  }
  if (expected !== undefined) {
    if (token !== normalizeAddress(expected.token, "expected token")) {
      throw new WorkflowError("UNSUPPORTED_TOKEN", "Deposit action changed the reviewed token.");
    }
    if (amount !== normalizeFelt(expected.amount, "expected amount")) {
      throw new WorkflowError("DISPLAYED_AMOUNT_MISMATCH", "Deposit action changed the reviewed amount.");
    }
  }
  return { type: "deposit", token, amount };
}

export function makeFinalExactIntent(
  originalIntent: WireShieldIntent,
  selection: ExecutionSelection,
  snapshot: PublicSnapshotBoundary,
  now: number,
  deadlineSeconds = 600,
): WireShieldIntent {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(deadlineSeconds) || deadlineSeconds <= 0) {
    throw new WorkflowError("INVALID_INTENT", "Final preflight time is invalid.");
  }
  return {
    action: "shield",
    chainId: originalIntent.chainId,
    account: originalIntent.account,
    token: selection.token,
    amount: selection.amount,
    evaluationBlock: snapshot.observedBlock,
    evaluationTimestamp: now,
    flexibility: { mode: "exact" },
    deadline: now + deadlineSeconds,
  };
}

export async function createGuardedDepositPlan(
  input: SigningDecisionInput,
  config: StarknetSpikeConfig,
): Promise<GuardedDepositPlan> {
  const snapshot = validateBoundary(input.snapshot, config);
  const original = checkedIntent(input.originalIntent, config);
  const originalIntent = original.wire;
  if (originalIntent.evaluationBlock !== snapshot.observedBlock) {
    throw new WorkflowError("SNAPSHOT_HASH_MISMATCH", "Initial intent does not reference the reviewed snapshot block.");
  }
  const initialPreflight = await validateAvailablePreflight(
    input.initialPreflight,
    originalIntent,
    snapshot,
    input.now,
  );
  const selectedAmount = validateSelection(originalIntent, initialPreflight, input.selection);
  if (parseBaseUnitAmount(input.displayedAmount, "displayed amount") !== selectedAmount) {
    throw new WorkflowError("DISPLAYED_AMOUNT_MISMATCH", "Final amount differs from the amount displayed to the user.");
  }
  const final = checkedIntent(input.finalIntent, config);
  const finalIntent = final.wire;
  if (
    finalIntent.flexibility.mode !== "exact" ||
    final.normalized.chainId !== original.normalized.chainId ||
    final.normalized.account !== original.normalized.account ||
    final.normalized.token !== original.normalized.token ||
    BigInt(finalIntent.amount) !== selectedAmount ||
    finalIntent.evaluationBlock !== snapshot.observedBlock
  ) {
    throw new WorkflowError("RECOMMENDATION_MISMATCH", "Final preflight intent does not exactly match the selected action.");
  }
  const finalPreflight = await validateAvailablePreflight(
    input.finalPreflight,
    finalIntent,
    snapshot,
    input.now,
  );
  if (finalPreflight.decision === "DENY") {
    throw new WorkflowError("GUARD_DENIED", "GUARD_POLICY-v1 denies this final amount.");
  }
  validateWallet(input.wallet, finalIntent, config);
  const built = buildDepositAction(final.normalized, config);
  const action: DepositAction = {
    type: "deposit",
    token: normalizeAddress(built.token, "deposit token"),
    amount: normalizeFelt(built.amount, "deposit amount"),
  };
  validateSingleDepositAction([action], action);
  return {
    status: "VALIDATED",
    originalIntent,
    finalIntent,
    selection: {
      ...input.selection,
      token: final.normalized.token,
      amount: selectedAmount.toString(10),
    },
    action,
    displayedAmount: selectedAmount.toString(10),
    chainId: final.normalized.chainId,
    poolAddress: snapshot.poolAddress,
    account: final.normalized.account,
    snapshotHash: snapshot.snapshotHash,
    decisionId: finalPreflight.decisionId,
    modelVersion: finalPreflight.modelVersion,
    guardPolicyVersion: finalPreflight.guardPolicyVersion,
    decision: finalPreflight.decision,
    riskBand: finalPreflight.riskBand,
    warningAcknowledgementRequired: finalPreflight.decision === "WARN",
    indexedThroughTimestamp: snapshot.indexedThroughTimestamp,
  };
}

export function validateSimulationEvidence(
  plan: GuardedDepositPlan,
  simulation: WalletSimulationEvidence,
): SimulatedDepositPlan {
  if (
    simulation.status !== "SIMULATED" ||
    simulation.simulateFlag !== true ||
    normalizeAddress(simulation.contractAddress, "simulation contract") !== plan.poolAddress ||
    simulation.entryPoint !== "apply_actions" ||
    !Number.isSafeInteger(simulation.calldataLength) ||
    simulation.calldataLength <= 0 ||
    simulation.proofEmpty !== true
  ) {
    throw new WorkflowError("SIMULATION_MISMATCH", "Wallet simulation does not match the reviewed STRK20 deposit path.");
  }
  return {
    status: "SIMULATED",
    plan,
    simulation,
    actionBinding: actionBinding(plan),
  };
}

export function assertGuardedDepositPlan(
  plan: GuardedDepositPlan,
  now: number,
): void {
  if (
    plan.status !== "VALIDATED" ||
    plan.modelVersion !== CUTOUT_MODEL.version ||
    plan.guardPolicyVersion !== GUARD_POLICY.version ||
    guardDecisionForBand(plan.riskBand) !== plan.decision ||
    !decisionAllowsWalletCall(plan.decision) ||
    plan.finalIntent.flexibility.mode !== "exact" ||
    plan.finalIntent.amount !== plan.selection.amount ||
    plan.displayedAmount !== plan.selection.amount ||
    normalizeAddress(plan.finalIntent.token, "final token") !==
      normalizeAddress(plan.selection.token, "selected token") ||
    normalizeAddress(plan.finalIntent.account, "final account") !== plan.account ||
    normalizeFelt(plan.finalIntent.chainId, "final chain") !== plan.chainId
  ) {
    throw new WorkflowError("INVALID_INTENT", "Guarded deposit plan is internally inconsistent.");
  }
  validateSingleDepositAction([plan.action], {
    token: plan.selection.token,
    amount: `0x${parseBaseUnitAmount(plan.selection.amount).toString(16)}`,
  });
  const sourceAge = now - plan.indexedThroughTimestamp;
  if (
    !Number.isSafeInteger(now) ||
    sourceAge < 0 ||
    sourceAge > FRESHNESS_POLICY.maximumSourceAgeSeconds
  ) {
    throw new WorkflowError("STALE_PREFLIGHT", "Guarded deposit plan is no longer fresh.");
  }
}

export function authorizeSubmission(input: {
  readonly simulated: SimulatedDepositPlan;
  readonly explicitUserApproval: boolean;
  readonly warningAcknowledged: boolean;
  readonly now: number;
}): SubmissionAuthorization {
  const { simulated } = input;
  assertGuardedDepositPlan(simulated.plan, input.now);
  if (simulated.status !== "SIMULATED" || simulated.actionBinding !== actionBinding(simulated.plan)) {
    throw new WorkflowError("SIMULATION_REQUIRED", "A matching wallet simulation is required before submission.");
  }
  if (!input.explicitUserApproval) {
    throw new WorkflowError("USER_APPROVAL_REQUIRED", "Explicit user approval is required before calling the wallet.");
  }
  if (simulated.plan.warningAcknowledgementRequired && !input.warningAcknowledged) {
    throw new WorkflowError(
      "WARNING_ACKNOWLEDGEMENT_REQUIRED",
      "The user must acknowledge the WARN decision before submission.",
    );
  }
  const sourceAge = input.now - simulated.plan.indexedThroughTimestamp;
  if (
    !Number.isSafeInteger(input.now) ||
    sourceAge < 0 ||
    sourceAge > FRESHNESS_POLICY.maximumSourceAgeSeconds
  ) {
    throw new WorkflowError("STALE_PREFLIGHT", "Final preflight became stale before wallet confirmation.");
  }
  return {
    status: "AUTHORIZED",
    action: simulated.plan.action,
    actionBinding: simulated.actionBinding,
    chainId: simulated.plan.chainId,
    poolAddress: simulated.plan.poolAddress,
    account: simulated.plan.account,
    snapshotHash: simulated.plan.snapshotHash,
    decisionId: simulated.plan.decisionId,
    modelVersion: simulated.plan.modelVersion,
    guardPolicyVersion: simulated.plan.guardPolicyVersion,
    decision: simulated.plan.decision,
    recommendationStatus: simulated.plan.selection.source === "RECOMMENDATION" ? "ACCEPTED" : "ORIGINAL",
    authorizedAt: input.now,
    explicitUserApproval: true,
  };
}

export function assertSubmissionAuthorization(value: SubmissionAuthorization): void {
  const action = validateSingleDepositAction([value.action], value.action);
  if (
    value.status !== "AUTHORIZED" ||
    value.explicitUserApproval !== true ||
    value.actionBinding !== actionBinding({
      chainId: value.chainId,
      poolAddress: value.poolAddress,
      account: value.account,
      action: value.action,
      snapshotHash: value.snapshotHash,
      decisionId: value.decisionId,
    }) ||
    action.type !== "deposit"
  ) {
    throw new WorkflowError("USER_APPROVAL_REQUIRED", "Submission authorization is invalid.");
  }
}

export function decisionAllowsWalletCall(decision: Decision): boolean {
  return decision === "ALLOW" || decision === "WARN";
}
