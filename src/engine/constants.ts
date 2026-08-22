export const CUTOUT_MODEL = {
  version: "CUTOUT-v1.3",
  observationSeconds: 30 * 24 * 60 * 60,
  cohortSeconds: 24 * 60 * 60,
  proximitySeconds: 60 * 60,
  channelSeconds: 30 * 60,
  thinCohort: 5,
  minAddresses: 3,
  maxTopShare: 0.5,
  maxBurstShare: 0.6,
  minActiveDays: 7,
  amountTolerance: 0n,
} as const;

export type CutoutModel = typeof CUTOUT_MODEL;

export const CUTOUT_MODEL_V1_4 = {
  ...CUTOUT_MODEL,
  version: "CUTOUT-v1.4",
  roundAmountDecimalPlaces: 2,
} as const;

export type CutoutModelV14 = typeof CUTOUT_MODEL_V1_4;
