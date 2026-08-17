export interface AggregateMetric {
  readonly count: number;
  readonly failureCount: number;
  readonly totalDurationMs: number;
  readonly averageDurationMs: number | null;
  readonly lastDurationMs: number | null;
}

export interface ApiOperationalMetrics {
  readonly preflight: AggregateMetric;
}

interface MutableAggregate {
  count: number;
  failureCount: number;
  totalDurationMs: number;
  lastDurationMs: number | null;
}

function snapshotAggregate(metric: MutableAggregate): AggregateMetric {
  return {
    ...metric,
    averageDurationMs:
      metric.count === 0
        ? null
        : Math.round((metric.totalDurationMs / metric.count) * 1_000) / 1_000,
  };
}

/** Process-local and aggregate only: no account, amount, or request identifiers. */
export class OperationalMetrics {
  private readonly preflight: MutableAggregate = {
    count: 0,
    failureCount: 0,
    totalDurationMs: 0,
    lastDurationMs: null,
  };

  recordPreflight(durationMs: number, failed: boolean): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.preflight.count += 1;
    if (failed) this.preflight.failureCount += 1;
    this.preflight.totalDurationMs += durationMs;
    this.preflight.lastDurationMs = durationMs;
  }

  snapshot(): ApiOperationalMetrics {
    return { preflight: snapshotAggregate(this.preflight) };
  }
}

const METRICS_KEY = Symbol.for("cutout.operationalMetrics.v1");

export function processOperationalMetrics(): OperationalMetrics {
  const scope = globalThis as typeof globalThis & {
    [METRICS_KEY]?: OperationalMetrics;
  };
  scope[METRICS_KEY] ??= new OperationalMetrics();
  return scope[METRICS_KEY];
}
