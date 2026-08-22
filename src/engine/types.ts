export type Address = `0x${string}`;
export type TransactionHash = `0x${string}`;

export type Action = "shield" | "private_transfer" | "withdraw" | "swap";
export type Band = "LOW" | "MEDIUM" | "HIGH";
export type Decision = "ALLOW" | "WARN" | "DENY";

export type AmountConstraint =
  | { mode: "exact"; value: bigint }
  | { mode: "flexible"; target: bigint; min: bigint; max: bigint };

export interface ShieldIntent {
  action: "shield";
  account: Address;
  token: Address;
  amount: AmountConstraint;
  deadline: number;
}

export interface WithdrawIntent {
  action: "withdraw";
  account: Address;
  recipient: Address;
  token: Address;
  amount: AmountConstraint;
  deadline: number;
}

export interface UnsupportedIntent {
  action: Exclude<Action, "shield">;
  account: Address;
  token: Address;
  amount: AmountConstraint;
  deadline: number;
}

export type Intent = ShieldIntent | UnsupportedIntent;

export interface V14UnsupportedIntent {
  action: Exclude<Action, "shield" | "withdraw">;
  account: Address;
  token: Address;
  amount: AmountConstraint;
  deadline: number;
}

export type V14Intent = ShieldIntent | WithdrawIntent | V14UnsupportedIntent;

export interface DepositObservation {
  blockNumber: number;
  timestamp: number;
  transactionHash: TransactionHash;
  depositor: Address;
  token: Address;
  amount: bigint;
}

export interface RegistrationObservation {
  blockNumber: number;
  timestamp: number;
  transactionHash: TransactionHash;
  account: Address;
}

export interface WithdrawalObservation {
  blockNumber: number;
  timestamp: number;
  transactionHash: TransactionHash;
  recipient: Address;
  token: Address;
  amount: bigint;
}

export interface PreflightInput {
  intent: Intent;
  now: number;
  deposits: readonly DepositObservation[];
  registrations: readonly RegistrationObservation[];
}

export interface PreflightInputV14 {
  intent: V14Intent;
  now: number;
  deposits: readonly DepositObservation[];
  withdrawals: readonly WithdrawalObservation[];
  registrations: readonly RegistrationObservation[];
  tokenDecimals: number;
}

export interface SignalResult {
  id: "S1" | "S2" | "S3" | "S4" | "S5" | "S7";
  status: "FIRED" | "CLEAR" | "NOT_APPLICABLE";
  summary: string;
}

export interface CohortQuality {
  existingMatches: number;
  projectedCohort: number;
  trafficEvents: number;
  distinctAddresses: number;
  distinctTransactions: number;
  topAddressShare: number;
  activeDays: number;
  maxBurstShare: number;
  healthy: boolean;
  failures: readonly string[];
}

export interface AmountRecommendation {
  kind: "CHANGE_AMOUNT";
  from: bigint;
  to: bigint;
  absoluteDeviation: bigint;
  cohort: CohortQuality;
}

export interface RefusalRecommendation {
  kind: "NO_SAFER_EXECUTION";
  reason: string;
}

export interface WaitRecommendation {
  kind: "WAIT";
  suggestedHorizonSeconds: number;
  reason: string;
}

export type Recommendation =
  | AmountRecommendation
  | WaitRecommendation
  | RefusalRecommendation;

export interface SupportedPreflightResult {
  status: "SUPPORTED";
  modelVersion: string;
  evaluatedAt: number;
  amount: bigint;
  band: Band;
  decision: Decision;
  signals: readonly SignalResult[];
  cohort: CohortQuality;
  recommendation?: Recommendation;
}

export interface UnsupportedPreflightResult {
  status: "UNSUPPORTED_ACTION";
  modelVersion: string;
  action: Exclude<Action, "shield">;
  reason: string;
}

export type PreflightResult = SupportedPreflightResult | UnsupportedPreflightResult;
