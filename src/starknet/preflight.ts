import { CUTOUT_MODEL, CUTOUT_MODEL_V1_4 } from "../engine/constants.js";
import { evaluatePreflight, evaluatePreflightV14 } from "../engine/evaluate.js";
import type { AmountConstraint } from "../engine/types.js";
import type { ReviewedPoolAbi } from "./abi.js";
import { validateShieldIntent, validateWithdrawIntent } from "./actions.js";
import type { StarknetSpikeConfig } from "./config.js";
import { SpikeError, spikeErrorCode } from "./errors.js";
import { validatePublicSnapshot } from "./freshness.js";
import { guardDecisionForBand } from "./policies.js";
import { hashPublicSnapshot } from "./snapshot.js";
import type {
  PublicSnapshot,
  SpikePreflightResult,
  SpikeShieldIntent,
  SpikeWithdrawIntent,
} from "./types.js";
import { tokenByAddress } from "./config.js";

const BASE_NON_CLAIMS = [
  "Candidate cohorts are public-observer evidence, not anonymity sets.",
  "Cutout does not claim anonymity, untraceability, unlinkability, or a probability of deanonymization.",
] as const;

function amountConstraint(intent: SpikeShieldIntent | SpikeWithdrawIntent): AmountConstraint {
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

function validateIntent(
  value: unknown,
  config: StarknetSpikeConfig,
): SpikeShieldIntent | SpikeWithdrawIntent {
  if (value !== null && typeof value === "object" && "action" in value) {
    if ((value as { readonly action?: unknown }).action === "withdraw") {
      return validateWithdrawIntent(value, config);
    }
  }
  return validateShieldIntent(value, config);
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
    const intent = validateIntent(input.intent, input.config);
    const freshness = validatePublicSnapshot(input.snapshot, intent, input.config, input.abi);
    if (input.snapshot.engineVersion === CUTOUT_MODEL.version && intent.action !== "shield") {
      throw new SpikeError(
        "UNSUPPORTED_ACTION",
        "CUTOUT-v1.3 defines causal scoring rules for shield preflight only.",
      );
    }
    const result = input.snapshot.engineVersion === CUTOUT_MODEL_V1_4.version
      ? evaluatePreflightV14({
          intent: intent.action === "shield"
            ? {
                action: "shield",
                account: intent.account,
                token: intent.token,
                amount: amountConstraint(intent),
                deadline: intent.deadline,
              }
            : {
                action: "withdraw",
                account: intent.account,
                recipient: intent.recipient,
                token: intent.token,
                amount: amountConstraint(intent),
                deadline: intent.deadline,
              },
          now: intent.evaluationTimestamp,
          deposits: input.snapshot.depositObservations,
          withdrawals: input.snapshot.withdrawalObservations ?? [],
          registrations: input.snapshot.viewingKeyRegistrationObservations,
          tokenDecimals: tokenByAddress(input.config, intent.token)?.decimals ?? -1,
        })
      : evaluatePreflight({
          intent: intent.action === "shield"
            ? {
                action: "shield",
                account: intent.account,
                token: intent.token,
                amount: amountConstraint(intent),
                deadline: intent.deadline,
              }
            : {
                action: "withdraw",
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
      nonClaims: [
        BASE_NON_CLAIMS[0],
        `LOW means only that ${result.modelVersion} placed this result in its LOW band under the published rules.`,
        BASE_NON_CLAIMS[1],
      ],
    };
  } catch (error) {
    return {
      status: "NO_CONFIDENT_RECOMMENDATION",
      modelVersion: input.snapshot.engineVersion === CUTOUT_MODEL_V1_4.version
        ? CUTOUT_MODEL_V1_4.version
        : CUTOUT_MODEL.version,
      error: {
        code: spikeErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
      },
      snapshotHash,
    };
  }
}
