import type {
  PreflightApiResponse,
  WireCohortQuality,
  WireRecommendation,
  WireShieldIntent,
} from "../api/types.js";

export type PreflightClientFailureCode =
  | "BACKEND_UNAVAILABLE"
  | "INVALID_RESPONSE";

export interface PreflightClientFailure {
  readonly status: "CLIENT_UNAVAILABLE";
  readonly code: PreflightClientFailureCode;
  readonly message: string;
}

export type PreflightClientResult = PreflightApiResponse | PreflightClientFailure;

export interface PreflightFetchResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export type PreflightFetch = (
  input: string,
  init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly cache: "no-store";
    readonly body: string;
    readonly signal?: AbortSignal;
  },
) => Promise<PreflightFetchResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function canonicalHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function integerNonnegative(value: unknown): value is number {
  return finiteNonnegative(value) && Number.isSafeInteger(value);
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function cohort(value: unknown): value is WireCohortQuality {
  if (!isRecord(value)) return false;
  return (
    integerNonnegative(value.existingMatches) &&
    integerNonnegative(value.projectedCohort) &&
    integerNonnegative(value.trafficEvents) &&
    integerNonnegative(value.distinctAddresses) &&
    integerNonnegative(value.distinctTransactions) &&
    finiteNonnegative(value.topAddressShare) &&
    integerNonnegative(value.activeDays) &&
    finiteNonnegative(value.maxBurstShare) &&
    typeof value.healthy === "boolean" &&
    stringArray(value.failures)
  );
}

function recommendation(value: unknown): value is WireRecommendation {
  if (value === null) return true;
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "NO_SAFER_EXECUTION") return typeof value.reason === "string";
  return (
    value.kind === "CHANGE_AMOUNT" &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    typeof value.absoluteDeviation === "string" &&
    cohort(value.cohort)
  );
}

function available(value: Record<string, unknown>): boolean {
  if (
    value.status !== "AVAILABLE" ||
    typeof value.modelVersion !== "string" ||
    typeof value.guardPolicyVersion !== "string" ||
    !["ALLOW", "WARN", "DENY"].includes(String(value.decision)) ||
    !["LOW", "MEDIUM", "HIGH"].includes(String(value.riskBand)) ||
    !canonicalHash(value.snapshotHash) ||
    !canonicalHash(value.decisionId) ||
    !Array.isArray(value.signals) ||
    !isRecord(value.candidateCohort) ||
    !cohort(value.cohortQuality) ||
    !recommendation(value.recommendation) ||
    !isRecord(value.freshness) ||
    !stringArray(value.nonClaims)
  ) {
    return false;
  }
  if (
    !integerNonnegative(value.candidateCohort.existingMatches) ||
    !integerNonnegative(value.candidateCohort.projectedCohort) ||
    value.signals.some((signal) =>
      !isRecord(signal) ||
      !["S1", "S2", "S3", "S4", "S5"].includes(String(signal.id)) ||
      !["FIRED", "CLEAR", "NOT_APPLICABLE"].includes(String(signal.status)) ||
      typeof signal.summary !== "string"
    )
  ) {
    return false;
  }
  const freshness = value.freshness;
  return (
    typeof freshness.policyVersion === "string" &&
    freshness.maximumSourceAgeSeconds === 120 &&
    freshness.maximumIndexLagSeconds === 120 &&
    integerNonnegative(freshness.sourceAgeSeconds) &&
    integerNonnegative(freshness.indexLagSeconds) &&
    integerNonnegative(freshness.observedBlock) &&
    integerNonnegative(freshness.indexedThroughBlock) &&
    integerNonnegative(freshness.rpcHeadBlock) &&
    freshness.sourceComplete === true
  );
}

function unavailable(value: Record<string, unknown>): boolean {
  return (
    value.status === "NO_CONFIDENT_RECOMMENDATION" &&
    typeof value.modelVersion === "string" &&
    typeof value.guardPolicyVersion === "string" &&
    (value.snapshotHash === null || canonicalHash(value.snapshotHash)) &&
    canonicalHash(value.decisionId) &&
    stringArray(value.nonClaims) &&
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string" &&
    !("decision" in value) &&
    !("riskBand" in value)
  );
}

export function parsePreflightApiResponse(value: unknown): PreflightApiResponse {
  if (!isRecord(value)) throw new Error("Preflight response is not an object.");
  if (available(value) || unavailable(value)) return value as unknown as PreflightApiResponse;
  throw new Error("Preflight response has an invalid fail-closed shape.");
}

export async function requestPreflight(
  fetcher: PreflightFetch,
  intent: WireShieldIntent,
  options: {
    readonly endpoint?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<PreflightClientResult> {
  let response: PreflightFetchResponse;
  try {
    response = await fetcher(options.endpoint ?? "/api/preflight", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      cache: "no-store",
      body: JSON.stringify(intent),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    return {
      status: "CLIENT_UNAVAILABLE",
      code: "BACKEND_UNAVAILABLE",
      message: `Cutout preflight service is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
    const parsed = parsePreflightApiResponse(body);
    if (
      (parsed.status === "AVAILABLE" && response.status !== 200) ||
      (parsed.status === "NO_CONFIDENT_RECOMMENDATION" && response.status === 200)
    ) {
      throw new Error("HTTP status and preflight availability disagree.");
    }
    return parsed;
  } catch (error) {
    return {
      status: "CLIENT_UNAVAILABLE",
      code: "INVALID_RESPONSE",
      message: `Cutout preflight response is invalid (HTTP ${response.status}): ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
