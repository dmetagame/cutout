import { CUTOUT_MODEL } from "../engine/constants.js";
import { evaluatePreflight } from "../engine/evaluate.js";
import type { AmountConstraint } from "../engine/types.js";
import type { ReviewedPoolAbi } from "./abi.js";
import { validateShieldIntent } from "./actions.js";
import type { StarknetSpikeConfig } from "./config.js";
import { SpikeError, spikeErrorCode } from "./errors.js";
import { validatePublicSnapshot } from "./freshness.js";
import { guardDecisionForBand } from "./policies.js";
import { hashPublicSnapshot } from "./snapshot.js";
import type {
  PublicSnapshot,
  SpikePreflightResult,
  SpikeShieldIntent,
} from "./types.js";

const NON_CLAIMS = [
  "Candidate cohorts are public-observer evidence, not anonymity sets.",
  "LOW means only that CUTOUT-v1.3 placed this result in its LOW band under the published rules.",
  "Cutout does not claim anonymity, untraceability, unlinkability, or a probability of deanonymization.",
] as const;

function amountConstraint(intent: SpikeShieldIntent): AmountConstraint {
  if (intent.flexibility.mode === "exact") {
    return { mode: "exact", value: intent.amount };
  }
  return {
    mode: "flexible",
    target: intent.amount,
    min: intent.flexibility.min,
    max: intent.flexibility.max,
  };
}

export function runSpikePreflight(input: {
  readonly snapshot: PublicSnapshot;
  readonly intent: unknown;
  readonly config: StarknetSpikeConfig;
  readonly abi: ReviewedPoolAbi;
}): SpikePreflightResult {
  let snapshotHash: `0x${string}` | null = null;
  try {
    snapshotHash = hashPublicSnapshot(input.snapshot);
    const intent = validateShieldIntent(input.intent, input.config);
    const freshness = validatePublicSnapshot(input.snapshot, intent, input.config, input.abi);
    const result = evaluatePreflight({
      intent: {
        action: "shield",
        account: intent.account,
        token: intent.token,
        amount: amountConstraint(intent),
        deadline: intent.deadline,
      },
      now: intent.evaluationTimestamp,
      deposits: input.snapshot.depositObservations,
      registrations: input.snapshot.viewingKeyRegistrationObservations,
    });
    if (result.status !== "SUPPORTED") {
      throw new SpikeError("UNSUPPORTED_ACTION", result.reason);
    }
    const decision = guardDecisionForBand(result.band);
    if (decision !== result.decision) {
      throw new SpikeError("ENGINE_VERSION_MISMATCH", "Engine and guard policy decisions disagree.");
    }
    return {
      status: "AVAILABLE",
      modelVersion: result.modelVersion,
      decision,
      riskBand: result.band,
      signals: result.signals,
      candidateCohort: {
        existingMatches: result.cohort.existingMatches,
        projectedCohort: result.cohort.projectedCohort,
      },
      cohortQuality: result.cohort,
      recommendation: result.recommendation ?? null,
      snapshotHash,
      freshness,
      nonClaims: NON_CLAIMS,
    };
  } catch (error) {
    return {
      status: "NO_CONFIDENT_RECOMMENDATION",
      modelVersion: CUTOUT_MODEL.version,
      error: {
        code: spikeErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
      },
      snapshotHash,
    };
  }
}
