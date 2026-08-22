import { CUTOUT_MODEL, CUTOUT_MODEL_V1_4 } from "./constants.js";
import type {
  Address,
  AmountConstraint,
  Band,
  CohortQuality,
  Decision,
  DepositObservation,
  PreflightInput,
  PreflightInputV14,
  PreflightResult,
  Recommendation,
  ShieldIntent,
  SignalResult,
  WithdrawIntent,
  WithdrawalObservation,
} from "./types.js";

const DAY = 86_400;

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function selectedAmount(constraint: AmountConstraint): bigint {
  return constraint.mode === "exact" ? constraint.value : constraint.target;
}

function inside(value: bigint, constraint: AmountConstraint): boolean {
  if (constraint.mode === "exact") return value === constraint.value;
  return value >= constraint.min && value <= constraint.max;
}

function absoluteDifference(left: bigint, right: bigint): bigint {
  return left >= right ? left - right : right - left;
}

function maximumBurstShare(timestamps: readonly number[]): number {
  if (timestamps.length === 0) return 1;
  const ordered = [...timestamps].sort((a, b) => a - b);
  let right = 0;
  let maximum = 0;
  for (let left = 0; left < ordered.length; left += 1) {
    const leftTimestamp = ordered[left];
    if (leftTimestamp === undefined) continue;
    while (right < ordered.length) {
      const rightTimestamp = ordered[right];
      if (
        rightTimestamp === undefined ||
        rightTimestamp - leftTimestamp > CUTOUT_MODEL.cohortSeconds
      ) {
        break;
      }
      right += 1;
    }
    maximum = Math.max(maximum, right - left);
  }
  return maximum / ordered.length;
}

function cohortFor(
  intent: ShieldIntent,
  amount: bigint,
  now: number,
  deposits: readonly DepositObservation[],
): CohortQuality {
  const observationStart = now - CUTOUT_MODEL.observationSeconds;
  const cohortStart = now - CUTOUT_MODEL.cohortSeconds;
  const observed = deposits.filter(
    (deposit) =>
      deposit.timestamp >= observationStart &&
      deposit.timestamp < now &&
      sameAddress(deposit.token, intent.token),
  );
  const matching = observed.filter((deposit) => deposit.amount === amount);
  const trailing = matching.filter((deposit) => deposit.timestamp >= cohortStart);
  const trafficEvents = observed.filter(
    (deposit) => deposit.timestamp >= cohortStart,
  ).length;

  const projected = [
    ...trailing,
    {
      blockNumber: Number.MAX_SAFE_INTEGER,
      timestamp: now,
      transactionHash: "0xcutout-projected" as const,
      depositor: intent.account,
      token: intent.token,
      amount,
    },
  ];
  const projectedObservation = [
    ...matching,
    projected[projected.length - 1] as DepositObservation,
  ];

  const addressCounts = new Map<string, number>();
  const transactions = new Set<string>();
  for (const deposit of projected) {
    const account = deposit.depositor.toLowerCase();
    addressCounts.set(account, (addressCounts.get(account) ?? 0) + 1);
    transactions.add(deposit.transactionHash.toLowerCase());
  }
  const topAddressCount = Math.max(...addressCounts.values());
  const topAddressShare = topAddressCount / projected.length;
  const activeDays = new Set(
    projectedObservation.map((deposit) => Math.floor(deposit.timestamp / DAY)),
  ).size;
  const maxBurstShare = maximumBurstShare(
    projectedObservation.map((deposit) => deposit.timestamp),
  );

  const failures: string[] = [];
  if (projected.length <= CUTOUT_MODEL.thinCohort) failures.push("THIN_COHORT");
  if (addressCounts.size < CUTOUT_MODEL.minAddresses) failures.push("LOW_ADDRESS_DIVERSITY");
  if (topAddressShare > CUTOUT_MODEL.maxTopShare) failures.push("TOP_ADDRESS_CONCENTRATION");
  if (activeDays < CUTOUT_MODEL.minActiveDays) failures.push("INSUFFICIENT_ACTIVE_DAYS");
  if (maxBurstShare > CUTOUT_MODEL.maxBurstShare) failures.push("BURST_CONCENTRATION");

  return {
    existingMatches: trailing.length,
    projectedCohort: projected.length,
    trafficEvents,
    distinctAddresses: addressCounts.size,
    distinctTransactions: transactions.size,
    topAddressShare,
    activeDays,
    maxBurstShare,
    healthy: failures.length === 0,
    failures,
  };
}

function bandFor(signals: readonly SignalResult[]): Band {
  const fired = signals.filter((signal) => signal.status === "FIRED").length;
  if (fired >= 3) return "HIGH";
  if (fired === 2) return "MEDIUM";
  return "LOW";
}

function decisionFor(band: Band): Decision {
  if (band === "HIGH") return "DENY";
  if (band === "MEDIUM") return "WARN";
  return "ALLOW";
}

function recommendationFor(
  intent: ShieldIntent,
  currentAmount: bigint,
  currentCohort: CohortQuality,
  now: number,
  deposits: readonly DepositObservation[],
): Recommendation | undefined {
  if (currentCohort.healthy) return undefined;
  if (intent.amount.mode === "exact") {
    return {
      kind: "NO_SAFER_EXECUTION",
      reason: "The amount is exact and no intent-preserving amount change is permitted.",
    };
  }

  const candidates = new Map<bigint, CohortQuality>();
  for (const deposit of deposits) {
    if (
      deposit.timestamp >= now - CUTOUT_MODEL.cohortSeconds &&
      deposit.timestamp < now &&
      sameAddress(deposit.token, intent.token) &&
      deposit.amount !== currentAmount &&
      inside(deposit.amount, intent.amount)
    ) {
      if (!candidates.has(deposit.amount)) {
        candidates.set(
          deposit.amount,
          cohortFor(intent, deposit.amount, now, deposits),
        );
      }
    }
  }

  const healthy = [...candidates.entries()]
    .filter(([, cohort]) => cohort.healthy)
    .sort(([leftAmount, left], [rightAmount, right]) => {
      const leftDeviation = absoluteDifference(leftAmount, currentAmount);
      const rightDeviation = absoluteDifference(rightAmount, currentAmount);
      if (leftDeviation !== rightDeviation) return leftDeviation < rightDeviation ? -1 : 1;
      if (left.projectedCohort !== right.projectedCohort) {
        return right.projectedCohort - left.projectedCohort;
      }
      return leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;
    });

  const best = healthy[0];
  if (best === undefined) {
    return {
      kind: "NO_SAFER_EXECUTION",
      reason: "No amount inside the authorised range has a healthy live cohort.",
    };
  }
  return {
    kind: "CHANGE_AMOUNT",
    from: currentAmount,
    to: best[0],
    absoluteDeviation: absoluteDifference(best[0], currentAmount),
    cohort: best[1],
  };
}

export function evaluatePreflight(input: PreflightInput): PreflightResult {
  if (input.intent.action !== "shield") {
    return {
      status: "UNSUPPORTED_ACTION",
      modelVersion: CUTOUT_MODEL.version,
      action: input.intent.action,
      reason: "CUTOUT-v1.3 defines causal scoring rules for shield preflight only.",
    };
  }

  const intent = input.intent;
  const amount = selectedAmount(intent.amount);
  const observationStart = input.now - CUTOUT_MODEL.observationSeconds;
  const priorExact = input.deposits.filter(
    (deposit) =>
      deposit.timestamp >= observationStart &&
      deposit.timestamp < input.now &&
      sameAddress(deposit.token, intent.token) &&
      deposit.amount === amount,
  );
  const recentRegistration = input.registrations.find(
    (registration) =>
      sameAddress(registration.account, intent.account) &&
      registration.timestamp >= input.now - CUTOUT_MODEL.channelSeconds &&
      registration.timestamp < input.now,
  );
  const cohort = cohortFor(intent, amount, input.now, input.deposits);

  const signals: SignalResult[] = [
    {
      id: "S1",
      status: priorExact.length === 0 ? "FIRED" : "CLEAR",
      summary:
        priorExact.length === 0
          ? "The projected deposit amount would occur once in the 30-day observation window."
          : `${priorExact.length} prior deposits use this exact token and amount in the observation window.`,
    },
    {
      id: "S2",
      status: "NOT_APPLICABLE",
      summary: "A prior withdrawal cannot be funded by a future deposit.",
    },
    {
      id: "S3",
      status: "NOT_APPLICABLE",
      summary: "Deposit-to-withdrawal proximity is not causal for shield preflight.",
    },
    {
      id: "S4",
      status: recentRegistration === undefined ? "CLEAR" : "FIRED",
      summary:
        recentRegistration === undefined
          ? "No viewing-key registration was observed for this account in the preceding 30 minutes."
          : `The account registered ${input.now - recentRegistration.timestamp} seconds before the proposed shield.`,
    },
    {
      id: "S5",
      status: cohort.healthy ? "CLEAR" : "FIRED",
      summary: cohort.healthy
        ? `Projected cohort ${cohort.projectedCohort} passes live and durability checks.`
        : `Projected cohort fails: ${cohort.failures.join(", ")}.`,
    },
  ];
  const band = bandFor(signals);
  const recommendation = recommendationFor(
    intent,
    amount,
    cohort,
    input.now,
    input.deposits,
  );

  return {
    status: "SUPPORTED",
    modelVersion: CUTOUT_MODEL.version,
    evaluatedAt: input.now,
    amount,
    band,
    decision: decisionFor(band),
    signals,
    cohort,
    ...(recommendation === undefined ? {} : { recommendation }),
  };
}

interface CohortObservation {
  readonly blockNumber: number;
  readonly timestamp: number;
  readonly transactionHash: `0x${string}`;
  readonly actor: Address;
  readonly token: Address;
  readonly amount: bigint;
}

function observationsForV14(
  intent: ShieldIntent | WithdrawIntent,
  deposits: readonly DepositObservation[],
  withdrawals: readonly WithdrawalObservation[],
): readonly CohortObservation[] {
  if (intent.action === "shield") {
    return deposits.map((deposit) => ({
      blockNumber: deposit.blockNumber,
      timestamp: deposit.timestamp,
      transactionHash: deposit.transactionHash,
      actor: deposit.depositor,
      token: deposit.token,
      amount: deposit.amount,
    }));
  }
  return withdrawals.map((withdrawal) => ({
    blockNumber: withdrawal.blockNumber,
    timestamp: withdrawal.timestamp,
    transactionHash: withdrawal.transactionHash,
    actor: withdrawal.recipient,
    token: withdrawal.token,
    amount: withdrawal.amount,
  }));
}

function cohortForV14(
  intent: ShieldIntent | WithdrawIntent,
  amount: bigint,
  now: number,
  deposits: readonly DepositObservation[],
  withdrawals: readonly WithdrawalObservation[],
): CohortQuality {
  const observationStart = now - CUTOUT_MODEL_V1_4.observationSeconds;
  const cohortStart = now - CUTOUT_MODEL_V1_4.cohortSeconds;
  const observations = observationsForV14(intent, deposits, withdrawals);
  const observed = observations.filter(
    (observation) =>
      observation.timestamp >= observationStart &&
      observation.timestamp < now &&
      sameAddress(observation.token, intent.token),
  );
  const matching = observed.filter((observation) => observation.amount === amount);
  const trailing = matching.filter((observation) => observation.timestamp >= cohortStart);
  const trafficEvents = observed.filter(
    (observation) => observation.timestamp >= cohortStart,
  ).length;
  const projected: readonly CohortObservation[] = [
    ...trailing,
    {
      blockNumber: Number.MAX_SAFE_INTEGER,
      timestamp: now,
      transactionHash: "0xcutout-projected",
      actor: intent.action === "shield" ? intent.account : intent.recipient,
      token: intent.token,
      amount,
    },
  ];
  const projectedObservation = [
    ...matching,
    projected[projected.length - 1] as CohortObservation,
  ];

  const addressCounts = new Map<string, number>();
  const transactions = new Set<string>();
  for (const observation of projected) {
    const actor = observation.actor.toLowerCase();
    addressCounts.set(actor, (addressCounts.get(actor) ?? 0) + 1);
    transactions.add(observation.transactionHash.toLowerCase());
  }
  const topAddressCount = Math.max(...addressCounts.values());
  const topAddressShare = topAddressCount / projected.length;
  const activeDays = new Set(
    projectedObservation.map((observation) => Math.floor(observation.timestamp / DAY)),
  ).size;
  const maxBurstShare = maximumBurstShare(
    projectedObservation.map((observation) => observation.timestamp),
  );

  const failures: string[] = [];
  if (projected.length <= CUTOUT_MODEL_V1_4.thinCohort) failures.push("THIN_COHORT");
  if (addressCounts.size < CUTOUT_MODEL_V1_4.minAddresses) {
    failures.push("LOW_ADDRESS_DIVERSITY");
  }
  if (topAddressShare > CUTOUT_MODEL_V1_4.maxTopShare) {
    failures.push("TOP_ADDRESS_CONCENTRATION");
  }
  if (activeDays < CUTOUT_MODEL_V1_4.minActiveDays) {
    failures.push("INSUFFICIENT_ACTIVE_DAYS");
  }
  if (maxBurstShare > CUTOUT_MODEL_V1_4.maxBurstShare) {
    failures.push("BURST_CONCENTRATION");
  }

  return {
    existingMatches: trailing.length,
    projectedCohort: projected.length,
    trafficEvents,
    distinctAddresses: addressCounts.size,
    distinctTransactions: transactions.size,
    topAddressShare,
    activeDays,
    maxBurstShare,
    healthy: failures.length === 0,
    failures,
  };
}

function isRoundAmount(amount: bigint, tokenDecimals: number): boolean {
  if (amount <= 0n) return false;
  const retainedDecimals = Math.min(
    tokenDecimals,
    CUTOUT_MODEL_V1_4.roundAmountDecimalPlaces,
  );
  const discardedDecimals = tokenDecimals - retainedDecimals;
  const unit = 10n ** BigInt(discardedDecimals);
  return amount % unit === 0n;
}

function bandForV14(signals: readonly SignalResult[]): Band {
  const s2 = signals.find((signal) => signal.id === "S2")?.status === "FIRED";
  const s3 = signals.find((signal) => signal.id === "S3")?.status === "FIRED";
  if (s2 && s3) return "HIGH";
  const fired = signals.filter((signal) => signal.status === "FIRED").length;
  if (fired >= 3) return "HIGH";
  if (fired === 2) return "MEDIUM";
  return "LOW";
}

function recommendationForV14(
  intent: ShieldIntent | WithdrawIntent,
  currentAmount: bigint,
  currentCohort: CohortQuality,
  now: number,
  deposits: readonly DepositObservation[],
  withdrawals: readonly WithdrawalObservation[],
): Recommendation | undefined {
  if (currentCohort.healthy) return undefined;

  if (intent.amount.mode === "flexible") {
    const candidates = new Map<bigint, CohortQuality>();
    for (const observation of observationsForV14(intent, deposits, withdrawals)) {
      if (
        observation.timestamp >= now - CUTOUT_MODEL_V1_4.cohortSeconds &&
        observation.timestamp < now &&
        sameAddress(observation.token, intent.token) &&
        observation.amount !== currentAmount &&
        inside(observation.amount, intent.amount) &&
        !candidates.has(observation.amount)
      ) {
        candidates.set(
          observation.amount,
          cohortForV14(intent, observation.amount, now, deposits, withdrawals),
        );
      }
    }
    const healthy = [...candidates.entries()]
      .filter(([, cohort]) => cohort.healthy)
      .sort(([leftAmount, left], [rightAmount, right]) => {
        const leftDeviation = absoluteDifference(leftAmount, currentAmount);
        const rightDeviation = absoluteDifference(rightAmount, currentAmount);
        if (leftDeviation !== rightDeviation) return leftDeviation < rightDeviation ? -1 : 1;
        if (left.projectedCohort !== right.projectedCohort) {
          return right.projectedCohort - left.projectedCohort;
        }
        return leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;
      });
    const best = healthy[0];
    if (best !== undefined) {
      return {
        kind: "CHANGE_AMOUNT",
        from: currentAmount,
        to: best[0],
        absoluteDeviation: absoluteDifference(best[0], currentAmount),
        cohort: best[1],
      };
    }
  }

  const waitHorizon = CUTOUT_MODEL_V1_4.cohortSeconds;
  const mayBenefitFromRecheck =
    currentCohort.projectedCohort <= CUTOUT_MODEL_V1_4.thinCohort ||
    currentCohort.failures.includes("BURST_CONCENTRATION");
  if (mayBenefitFromRecheck && intent.deadline - now >= waitHorizon) {
    return {
      kind: "WAIT",
      suggestedHorizonSeconds: waitHorizon,
      reason:
        "Re-run preflight after one trailing cohort window. Cutout does not predict or create future cover.",
    };
  }

  return {
    kind: "NO_SAFER_EXECUTION",
    reason:
      intent.amount.mode === "exact"
        ? "The amount is exact and no intent-preserving amount change is permitted."
        : "No amount inside the authorised range has a healthy live cohort.",
  };
}

export function evaluatePreflightV14(input: PreflightInputV14): PreflightResult {
  if (input.intent.action !== "shield" && input.intent.action !== "withdraw") {
    return {
      status: "UNSUPPORTED_ACTION",
      modelVersion: CUTOUT_MODEL_V1_4.version,
      action: input.intent.action,
      reason: "CUTOUT-v1.4 defines causal scoring rules for shield and withdraw preflight only.",
    };
  }
  if (
    !Number.isSafeInteger(input.tokenDecimals) ||
    input.tokenDecimals < 0 ||
    input.tokenDecimals > 255
  ) {
    throw new RangeError("tokenDecimals must be an integer between 0 and 255.");
  }

  const intent = input.intent;
  const amount = selectedAmount(intent.amount);
  const observations = observationsForV14(intent, input.deposits, input.withdrawals);
  const priorExact = observations.filter(
    (observation) =>
      observation.timestamp >= input.now - CUTOUT_MODEL_V1_4.observationSeconds &&
      observation.timestamp < input.now &&
      sameAddress(observation.token, intent.token) &&
      observation.amount === amount,
  );
  const counterpartDeposits = intent.action === "withdraw"
    ? input.deposits.filter(
        (deposit) =>
          deposit.timestamp >= input.now - CUTOUT_MODEL_V1_4.observationSeconds &&
          deposit.timestamp < input.now &&
          sameAddress(deposit.token, intent.token) &&
          deposit.amount === amount,
      )
    : [];
  const nearbyCounterpart = counterpartDeposits
    .filter((deposit) => input.now - deposit.timestamp <= CUTOUT_MODEL_V1_4.proximitySeconds)
    .sort((left, right) => right.timestamp - left.timestamp)[0];
  const recentRegistration = intent.action === "shield"
    ? input.registrations.find(
        (registration) =>
          sameAddress(registration.account, intent.account) &&
          registration.timestamp >= input.now - CUTOUT_MODEL_V1_4.channelSeconds &&
          registration.timestamp < input.now,
      )
    : undefined;
  const cohort = cohortForV14(
    intent,
    amount,
    input.now,
    input.deposits,
    input.withdrawals,
  );

  const signals: SignalResult[] = [
    {
      id: "S1",
      status: priorExact.length === 0 ? "FIRED" : "CLEAR",
      summary:
        priorExact.length === 0
          ? `The projected ${intent.action} amount would occur once in the 30-day observation window.`
          : `${priorExact.length} prior ${intent.action} observations use this exact token and amount.`,
    },
    intent.action === "shield"
      ? {
          id: "S2",
          status: "NOT_APPLICABLE",
          summary: "A prior withdrawal cannot be funded by a future deposit.",
        }
      : {
          id: "S2",
          status: counterpartDeposits.length === 0 ? "CLEAR" : "FIRED",
          summary:
            counterpartDeposits.length === 0
              ? "No exact same-token deposit counterpart was observed in the 30-day window."
              : `${counterpartDeposits.length} exact same-token deposit counterpart observations were found.`,
        },
    intent.action === "shield"
      ? {
          id: "S3",
          status: "NOT_APPLICABLE",
          summary: "Deposit-to-withdrawal proximity is not causal for shield preflight.",
        }
      : {
          id: "S3",
          status: nearbyCounterpart === undefined ? "CLEAR" : "FIRED",
          summary:
            nearbyCounterpart === undefined
              ? "No exact same-token deposit occurred within the preceding 60 minutes."
              : `The nearest exact deposit occurred ${input.now - nearbyCounterpart.timestamp} seconds before the proposed withdrawal.`,
        },
    intent.action === "withdraw"
      ? {
          id: "S4",
          status: "NOT_APPLICABLE",
          summary: "Channel-open proximity is defined for shield preflight, not public withdrawal.",
        }
      : {
          id: "S4",
          status: recentRegistration === undefined ? "CLEAR" : "FIRED",
          summary:
            recentRegistration === undefined
              ? "No viewing-key registration was observed for this account in the preceding 30 minutes."
              : `The account registered ${input.now - recentRegistration.timestamp} seconds before the proposed shield.`,
        },
    {
      id: "S5",
      status: cohort.healthy ? "CLEAR" : "FIRED",
      summary: cohort.healthy
        ? `Projected cohort ${cohort.projectedCohort} passes live and durability checks.`
        : `Projected cohort fails: ${cohort.failures.join(", ")}.`,
    },
    {
      id: "S7",
      status:
        priorExact.length === 0 && isRoundAmount(amount, input.tokenDecimals)
          ? "FIRED"
          : "CLEAR",
      summary:
        priorExact.length === 0 && isRoundAmount(amount, input.tokenDecimals)
          ? "The amount uses at most two displayed decimal places and has no prior exact cohort."
          : "The amount is not a new round-amount fingerprint under CUTOUT-v1.4.",
    },
  ];
  const band = bandForV14(signals);
  const recommendation = recommendationForV14(
    intent,
    amount,
    cohort,
    input.now,
    input.deposits,
    input.withdrawals,
  );

  return {
    status: "SUPPORTED",
    modelVersion: CUTOUT_MODEL_V1_4.version,
    evaluatedAt: input.now,
    amount,
    band,
    decision: decisionFor(band),
    signals,
    cohort,
    ...(recommendation === undefined ? {} : { recommendation }),
  };
}
