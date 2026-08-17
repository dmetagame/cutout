import type { Band, Decision } from "../engine/types.js";

export const FRESHNESS_POLICY = {
  version: "FRESHNESS_POLICY-v1",
  maximumSourceAgeSeconds: 120,
  maximumIndexLagSeconds: 120,
} as const;

export const GUARD_POLICY = {
  version: "GUARD_POLICY-v1",
  decisions: {
    HIGH: "DENY",
    MEDIUM: "WARN",
    LOW: "ALLOW",
  },
} as const satisfies {
  readonly version: string;
  readonly decisions: Readonly<Record<Band, Decision>>;
};

export function guardDecisionForBand(band: Band): Decision {
  return GUARD_POLICY.decisions[band];
}
