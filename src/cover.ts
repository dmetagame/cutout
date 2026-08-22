import { CUTOUT_MODEL, CUTOUT_MODEL_V1_4 } from "./engine/constants.js";
import type {
  Address,
  Band,
  CohortQuality,
  ShieldIntent,
  WithdrawIntent,
} from "./engine/types.js";
import { evaluatePreflight, evaluatePreflightV14 } from "./engine/evaluate.js";
import type { ReviewedPoolAbi } from "./starknet/abi.js";
import type { StarknetSpikeConfig, SupportedToken } from "./starknet/config.js";
import { validatePublicSnapshot } from "./starknet/freshness.js";
import { hashPublicSnapshot } from "./starknet/snapshot.js";
import type { PublicSnapshot, SnapshotFreshness, SpikeShieldIntent } from "./starknet/types.js";

const COVER_ROW_LIMIT = 7;
const COVER_SUGGESTION_LIMIT = 5;
const SYNTHETIC_ACCOUNT = "0x1" as Address;

export interface PublicCoverCohort {
  readonly amount: string;
  readonly existingMatches: number;
  readonly projectedCohort: number;
  readonly distinctAddresses: number;
  readonly distinctTransactions: number;
  readonly topAddressShare: number;
  readonly activeDays: number;
  readonly maxBurstShare: number;
  readonly healthy: boolean;
  readonly failures: readonly string[];
  readonly band: Band;
}

export interface PublicCoverToken {
  readonly address: string;
  readonly symbol: SupportedToken["symbol"];
  readonly decimals: number;
  readonly actions: readonly PublicCoverAction[];
}

export interface PublicCoverAction {
  readonly action: "shield" | "withdraw";
  readonly trailingEvents: number;
  readonly distinctAddresses: number;
  readonly unmatchedExactShare: number;
  readonly cohorts: readonly PublicCoverCohort[];
  readonly suggestions: readonly string[];
}

export interface PublicCover {
  readonly status: "CURRENT";
  readonly snapshotHash: `0x${string}`;
  readonly observedBlock: number;
  readonly observedTimestamp: number;
  readonly indexedThroughBlock: number;
  readonly engineVersion: string;
  readonly freshness: SnapshotFreshness;
  readonly tokens: readonly PublicCoverToken[];
}

function baseIntent(
  snapshot: PublicSnapshot,
  config: StarknetSpikeConfig,
  now: number,
  token: Address,
  amount: bigint,
): SpikeShieldIntent {
  return {
    action: "shield",
    chainId: config.chainId,
    account: SYNTHETIC_ACCOUNT,
    token,
    amount,
    evaluationBlock: snapshot.observedBlock,
    evaluationTimestamp: now,
    flexibility: { mode: "exact" },
    deadline: now + 60,
  };
}

function evaluatedCohort(
  snapshot: PublicSnapshot,
  token: SupportedToken,
  amount: bigint,
  now: number,
  action: PublicCoverAction["action"],
): { readonly band: Band; readonly cohort: CohortQuality } {
  const intent: ShieldIntent | WithdrawIntent = action === "shield"
    ? {
        action: "shield",
        account: SYNTHETIC_ACCOUNT,
        token: token.address,
        amount: { mode: "exact", value: amount },
        deadline: now + 60,
      }
    : {
        action: "withdraw",
        account: SYNTHETIC_ACCOUNT,
        recipient: SYNTHETIC_ACCOUNT,
        token: token.address,
        amount: { mode: "exact", value: amount },
        deadline: now + 60,
      };
  const result = snapshot.engineVersion === CUTOUT_MODEL_V1_4.version
    ? evaluatePreflightV14({
        intent,
        now,
        deposits: snapshot.depositObservations,
        withdrawals: snapshot.withdrawalObservations ?? [],
        registrations: snapshot.viewingKeyRegistrationObservations,
        tokenDecimals: token.decimals,
      })
    : evaluatePreflight({
        intent: intent as ShieldIntent,
        now,
        deposits: snapshot.depositObservations,
        registrations: snapshot.viewingKeyRegistrationObservations,
      });
  if (result.status !== "SUPPORTED") {
    throw new Error("Cover evaluator rejected a supported shield intent.");
  }
  return { band: result.band, cohort: result.cohort };
}

interface CoverObservation {
  readonly timestamp: number;
  readonly transactionHash: `0x${string}`;
  readonly actor: Address;
  readonly token: Address;
  readonly amount: bigint;
}

function coverAction(
  snapshot: PublicSnapshot,
  token: SupportedToken,
  now: number,
  action: PublicCoverAction["action"],
): PublicCoverAction {
  const model = snapshot.engineVersion === CUTOUT_MODEL_V1_4.version
    ? CUTOUT_MODEL_V1_4
    : CUTOUT_MODEL;
  const cohortStart = now - model.cohortSeconds;
  const observationStart = now - model.observationSeconds;
  const source: readonly CoverObservation[] = action === "shield"
    ? snapshot.depositObservations.map((observation) => ({
        timestamp: observation.timestamp,
        transactionHash: observation.transactionHash,
        actor: observation.depositor,
        token: observation.token,
        amount: observation.amount,
      }))
    : (snapshot.withdrawalObservations ?? []).map((observation) => ({
        timestamp: observation.timestamp,
        transactionHash: observation.transactionHash,
        actor: observation.recipient,
        token: observation.token,
        amount: observation.amount,
      }));
  const tokenObservations = source.filter(
    (observation) =>
      observation.token === token.address &&
      observation.timestamp >= observationStart &&
      observation.timestamp < now,
  );
  const trailing = tokenObservations.filter(
    (observation) => observation.timestamp >= cohortStart,
  );
  const byAmount = new Map<bigint, CoverObservation[]>();
  const priorCounts = new Map<bigint, number>();
  let unmatched = 0;
  for (const observation of tokenObservations) {
    const prior = priorCounts.get(observation.amount) ?? 0;
    if (prior === 0) unmatched += 1;
    priorCounts.set(observation.amount, prior + 1);
    if (observation.timestamp >= cohortStart) {
      const observations = byAmount.get(observation.amount);
      if (observations === undefined) byAmount.set(observation.amount, [observation]);
      else observations.push(observation);
    }
  }

  const shortlisted = [...byAmount.entries()]
    .sort(([leftAmount, left], [rightAmount, right]) => {
      if (left.length !== right.length) return right.length - left.length;
      return leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;
    })
    .slice(0, COVER_ROW_LIMIT);
  const cohorts = shortlisted
    .map(([amount, observations]) => {
      const evaluated = evaluatedCohort(snapshot, token, amount, now, action);
      return {
        amount: amount.toString(10),
        existingMatches: observations.length,
        projectedCohort: evaluated.cohort.projectedCohort,
        distinctAddresses: evaluated.cohort.distinctAddresses,
        distinctTransactions: evaluated.cohort.distinctTransactions,
        topAddressShare: evaluated.cohort.topAddressShare,
        activeDays: evaluated.cohort.activeDays,
        maxBurstShare: evaluated.cohort.maxBurstShare,
        healthy: evaluated.cohort.healthy,
        failures: evaluated.cohort.failures,
        band: evaluated.band,
      } satisfies PublicCoverCohort;
    })
    .sort((left, right) => {
      if (left.existingMatches !== right.existingMatches) {
        return right.existingMatches - left.existingMatches;
      }
      const leftAmount = BigInt(left.amount);
      const rightAmount = BigInt(right.amount);
      return leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;
    });

  const suggestions = cohorts
    .filter((cohort) => cohort.healthy && cohort.band === "LOW")
    .slice(0, COVER_SUGGESTION_LIMIT)
    .map((cohort) => cohort.amount);
  const distinctAddresses = new Set(trailing.map((observation) => observation.actor)).size;

  return {
    action,
    trailingEvents: trailing.length,
    distinctAddresses,
    unmatchedExactShare:
      tokenObservations.length === 0 ? 0 : unmatched / tokenObservations.length,
    cohorts,
    suggestions,
  };
}

function coverToken(
  snapshot: PublicSnapshot,
  token: SupportedToken,
  now: number,
): PublicCoverToken {
  return {
    address: token.address,
    symbol: token.symbol,
    decimals: token.decimals,
    actions: [
      coverAction(snapshot, token, now, "shield"),
      ...(snapshot.engineVersion === CUTOUT_MODEL_V1_4.version
        ? [coverAction(snapshot, token, now, "withdraw")] as const
        : []),
    ],
  };
}

export function buildPublicCover(input: {
  readonly snapshot: PublicSnapshot;
  readonly config: StarknetSpikeConfig;
  readonly abi: ReviewedPoolAbi;
  readonly now: number;
}): PublicCover {
  const firstToken = input.config.tokens[0];
  if (firstToken === undefined) throw new Error("Cover requires at least one configured token.");
  const freshness = validatePublicSnapshot(
    input.snapshot,
    baseIntent(input.snapshot, input.config, input.now, firstToken.address, 1n),
    input.config,
    input.abi,
  );
  return {
    status: "CURRENT",
    snapshotHash: hashPublicSnapshot(input.snapshot),
    observedBlock: input.snapshot.observedBlock,
    observedTimestamp: input.snapshot.observedTimestamp,
    indexedThroughBlock: input.snapshot.indexedThroughBlock,
    engineVersion: input.snapshot.engineVersion,
    freshness,
    tokens: input.config.tokens.map((token) => coverToken(input.snapshot, token, input.now)),
  };
}
