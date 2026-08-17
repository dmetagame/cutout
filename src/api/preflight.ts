import { CUTOUT_MODEL } from "../engine/constants.js";
import type { Recommendation } from "../engine/types.js";
import type { ReviewedPoolAbi } from "../starknet/abi.js";
import type { StarknetSpikeConfig } from "../starknet/config.js";
import type { SpikeErrorCode } from "../starknet/errors.js";
import { GUARD_POLICY } from "../starknet/policies.js";
import { runSpikePreflight } from "../starknet/preflight.js";
import type { SpikeShieldIntent } from "../starknet/types.js";
import { DataLayerError } from "../indexer/errors.js";
import { CanonicalStore } from "../indexer/store.js";
import { deterministicId } from "./canonical.js";
import type {
  PreflightApiErrorCode,
  PreflightApiResponse,
  WireRecommendation,
  WireShieldIntent,
} from "./types.js";

const NON_CLAIMS = [
  "Candidate cohorts are public-observer evidence, not anonymity sets.",
  "LOW means only that CUTOUT-v1.3 placed this result in its LOW band under the published rules.",
  "Cutout does not claim anonymity, untraceability, unlinkability, or a probability of deanonymization.",
] as const;

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

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function wireAmount(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new ApiInputError("INVALID_INTENT", `${field} must be a positive base-unit decimal string.`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new ApiInputError("INVALID_INTENT", `${field} is outside the supported integer range.`);
  }
}

class ApiInputError extends Error {
  readonly code: PreflightApiErrorCode;

  constructor(code: PreflightApiErrorCode, message: string) {
    super(message);
    this.name = "ApiInputError";
    this.code = code;
  }
}

export function parseWireShieldIntent(value: unknown): SpikeShieldIntent {
  if (!isRecord(value) || !hasOnlyKeys(value, INTENT_KEYS)) {
    throw new ApiInputError("INVALID_INTENT", "Request must contain exactly one typed shield intent.");
  }
  if (value.action !== "shield") {
    throw new ApiInputError("UNSUPPORTED_ACTION", "Only STRK20 shield/deposit preflight is supported.");
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
    throw new ApiInputError("INVALID_INTENT", "Shield intent fields have invalid JSON types.");
  }
  const amount = wireAmount(value.amount, "amount");
  if (!isRecord(value.flexibility) || typeof value.flexibility.mode !== "string") {
    throw new ApiInputError("INVALID_INTENT", "Flexibility constraints are required.");
  }
  let flexibility: SpikeShieldIntent["flexibility"];
  if (value.flexibility.mode === "exact") {
    if (!hasOnlyKeys(value.flexibility, new Set(["mode"]))) {
      throw new ApiInputError("INVALID_INTENT", "Exact flexibility has an invalid shape.");
    }
    flexibility = { mode: "exact" };
  } else if (
    value.flexibility.mode === "flexible" &&
    hasOnlyKeys(value.flexibility, new Set(["mode", "min", "max"]))
  ) {
    flexibility = {
      mode: "flexible",
      min: wireAmount(value.flexibility.min, "flexibility.min"),
      max: wireAmount(value.flexibility.max, "flexibility.max"),
    };
  } else {
    throw new ApiInputError("INVALID_INTENT", "Flexibility constraints have an invalid shape.");
  }
  return {
    action: "shield",
    chainId: value.chainId as SpikeShieldIntent["chainId"],
    account: value.account as SpikeShieldIntent["account"],
    token: value.token as SpikeShieldIntent["token"],
    amount,
    evaluationBlock: value.evaluationBlock,
    evaluationTimestamp: value.evaluationTimestamp,
    flexibility,
    deadline: value.deadline,
  };
}

function canonicalIntent(intent: SpikeShieldIntent): WireShieldIntent {
  return {
    action: "shield",
    chainId: intent.chainId,
    account: intent.account,
    token: intent.token,
    amount: intent.amount.toString(10),
    evaluationBlock: intent.evaluationBlock,
    evaluationTimestamp: intent.evaluationTimestamp,
    flexibility:
      intent.flexibility.mode === "exact"
        ? { mode: "exact" }
        : {
            mode: "flexible",
            min: intent.flexibility.min.toString(10),
            max: intent.flexibility.max.toString(10),
          },
    deadline: intent.deadline,
  };
}

function wireRecommendation(recommendation: Recommendation | null): WireRecommendation {
  if (recommendation === null || recommendation.kind === "NO_SAFER_EXECUTION") {
    return recommendation;
  }
  return {
    kind: "CHANGE_AMOUNT",
    from: recommendation.from.toString(10),
    to: recommendation.to.toString(10),
    absoluteDeviation: recommendation.absoluteDeviation.toString(10),
    cohort: recommendation.cohort,
  };
}

function mapSpikeError(code: SpikeErrorCode | "UNKNOWN"): PreflightApiErrorCode {
  switch (code) {
    case "INVALID_INTENT":
    case "INVALID_AMOUNT":
    case "INVALID_AMOUNT_BOUNDS":
    case "INVALID_CHAIN":
    case "INVALID_ADDRESS":
      return "INVALID_INTENT";
    case "UNSUPPORTED_ACTION":
      return "UNSUPPORTED_ACTION";
    case "UNSUPPORTED_TOKEN":
      return "UNSUPPORTED_TOKEN";
    case "POOL_ADDRESS_MISMATCH":
      return "UNKNOWN_POOL";
    case "RPC_ERROR":
      return "RPC_UNAVAILABLE";
    case "RPC_DATA_STALE":
      return "STALE_RPC";
    case "INDEX_LAG_EXCEEDED":
      return "INDEX_LAG";
    case "BLOCK_HASH_INCONSISTENT":
    case "PARENT_LINK_BROKEN":
    case "RPC_HEAD_INCONSISTENT":
    case "CHAIN_ID_MISMATCH":
      return "INCONSISTENT_BLOCK_DATA";
    case "SOURCE_INCOMPLETE":
      return "INSUFFICIENT_HISTORY";
    case "ENGINE_VERSION_MISMATCH":
    case "FRESHNESS_POLICY_VERSION_MISMATCH":
      return "MODEL_VERSION_MISMATCH";
    case "POOL_ABI_INVALID":
    case "POOL_ABI_MISMATCH":
    case "EVENT_SCHEMA_INVALID":
    case "UNKNOWN_EVENT_SELECTOR":
      return "POOL_SCHEMA_MISMATCH";
    case "SNAPSHOT_INCOMPLETE":
    case "UNKNOWN":
    default:
      return "INDEX_CORRUPT";
  }
}

function unavailable(input: {
  readonly intent: SpikeShieldIntent | null;
  readonly code: PreflightApiErrorCode;
  readonly message: string;
  readonly snapshotHash: `0x${string}` | null;
}): PreflightApiResponse {
  const core = {
    status: "NO_CONFIDENT_RECOMMENDATION" as const,
    modelVersion: CUTOUT_MODEL.version,
    guardPolicyVersion: GUARD_POLICY.version,
    error: { code: input.code, message: input.message },
    snapshotHash: input.snapshotHash,
    nonClaims: NON_CLAIMS,
  };
  return {
    ...core,
    decisionId: deterministicId({
      status: core.status,
      modelVersion: core.modelVersion,
      guardPolicyVersion: core.guardPolicyVersion,
      errorCode: input.code,
      snapshotHash: input.snapshotHash,
      intent: input.intent === null ? null : canonicalIntent(input.intent),
    }),
  };
}

export function unavailablePreflightResponse(
  code: PreflightApiErrorCode,
  message: string,
): PreflightApiResponse {
  return unavailable({ intent: null, code, message, snapshotHash: null });
}

export class PreflightService {
  readonly store: CanonicalStore;
  readonly config: StarknetSpikeConfig;
  readonly abi: ReviewedPoolAbi;
  readonly now: () => number;
  readonly maximumIntentClockSkewSeconds: number;

  constructor(
    store: CanonicalStore,
    config: StarknetSpikeConfig,
    abi: ReviewedPoolAbi,
    options: {
      readonly now?: () => number;
      readonly maximumIntentClockSkewSeconds?: number;
    } = {},
  ) {
    this.store = store;
    this.config = config;
    this.abi = abi;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.maximumIntentClockSkewSeconds = options.maximumIntentClockSkewSeconds ?? 5;
  }

  preflight(request: unknown): PreflightApiResponse {
    let intent: SpikeShieldIntent | null = null;
    try {
      intent = parseWireShieldIntent(request);
    } catch (error) {
      const inputError = error instanceof ApiInputError
        ? error
        : new ApiInputError("INVALID_INTENT", "Request is not a valid shield intent.");
      return unavailable({
        intent: null,
        code: inputError.code,
        message: inputError.message,
        snapshotHash: null,
      });
    }

    const serverNow = this.now();
    if (
      !Number.isSafeInteger(serverNow) ||
      serverNow < 0 ||
      Math.abs(intent.evaluationTimestamp - serverNow) > this.maximumIntentClockSkewSeconds
    ) {
      return unavailable({
        intent,
        code: "INVALID_INTENT",
        message: "Evaluation timestamp is not current for this preflight service.",
        snapshotHash: null,
      });
    }

    let snapshot;
    try {
      snapshot = this.store.loadCompleteSnapshot();
    } catch (error) {
      const dataError = error instanceof DataLayerError
        ? error
        : new DataLayerError("INDEX_CORRUPT", "Canonical snapshot could not be loaded.");
      return unavailable({
        intent,
        code: dataError.code,
        message: dataError.message,
        snapshotHash: null,
      });
    }

    const result = runSpikePreflight({
      snapshot,
      intent,
      config: this.config,
      abi: this.abi,
    });
    if (result.status !== "AVAILABLE") {
      return unavailable({
        intent,
        code: mapSpikeError(result.error.code),
        message: result.error.message,
        snapshotHash: result.snapshotHash,
      });
    }
    const core = {
      status: "AVAILABLE" as const,
      modelVersion: result.modelVersion,
      guardPolicyVersion: GUARD_POLICY.version,
      decision: result.decision,
      riskBand: result.riskBand,
      signals: result.signals,
      candidateCohort: result.candidateCohort,
      cohortQuality: result.cohortQuality,
      recommendation: wireRecommendation(result.recommendation),
      freshness: result.freshness,
      snapshotHash: result.snapshotHash,
      nonClaims: result.nonClaims,
    };
    return {
      ...core,
      decisionId: deterministicId({
        modelVersion: core.modelVersion,
        guardPolicyVersion: core.guardPolicyVersion,
        snapshotHash: core.snapshotHash,
        intent: canonicalIntent(intent),
        decision: core.decision,
        riskBand: core.riskBand,
        signals: core.signals,
        cohortQuality: core.cohortQuality,
        recommendation: core.recommendation,
      }),
    };
  }
}
