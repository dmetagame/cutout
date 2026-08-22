import {
  useCallback,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

import type { PreflightApiResponse, WireIntent } from "./api/types.js";
import {
  requestPreflight,
  type PreflightClientFailure,
  type PreflightFetch,
} from "./workflow/preflight-client.js";

export type CutoutEvidenceState =
  | { readonly status: "IDLE" }
  | { readonly status: "CHECKING" }
  | { readonly status: "AVAILABLE"; readonly response: Extract<PreflightApiResponse, { status: "AVAILABLE" }> }
  | { readonly status: "UNAVAILABLE"; readonly response: Exclude<PreflightApiResponse, { status: "AVAILABLE" }> | PreflightClientFailure };

export interface UseCutoutEvidenceOptions {
  readonly fetcher?: PreflightFetch;
  readonly endpoint?: string;
}

function browserFetch(): PreflightFetch {
  if (typeof window === "undefined") {
    throw new Error("A fetcher is required when useCutoutEvidence runs outside a browser.");
  }
  return window.fetch.bind(window) as unknown as PreflightFetch;
}

/**
 * Headless preflight state for integrators. It reads evidence only: no wallet,
 * simulation, authorization, invoke, or submission capability is imported.
 */
export function useCutoutEvidence(
  options: UseCutoutEvidenceOptions = {},
): {
  readonly state: CutoutEvidenceState;
  readonly check: (intent: WireIntent) => Promise<CutoutEvidenceState>;
  readonly reset: () => void;
} {
  const [state, setState] = useState<CutoutEvidenceState>({ status: "IDLE" });
  const endpoint = options.endpoint;
  const fetcher = options.fetcher;

  const check = useCallback(async (intent: WireIntent): Promise<CutoutEvidenceState> => {
    setState({ status: "CHECKING" });
    const response = await requestPreflight(fetcher ?? browserFetch(), intent, {
      ...(endpoint === undefined ? {} : { endpoint }),
    });
    const next: CutoutEvidenceState = response.status === "AVAILABLE"
      ? { status: "AVAILABLE", response }
      : { status: "UNAVAILABLE", response };
    setState(next);
    return next;
  }, [endpoint, fetcher]);

  const reset = useCallback(() => setState({ status: "IDLE" }), []);
  return { state, check, reset };
}

export interface CutoutEvidencePanelProps {
  readonly response: PreflightApiResponse;
  readonly title?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

function classNames(...values: readonly (string | undefined)[]): string {
  return values.filter((value): value is string => value !== undefined && value.length > 0).join(" ");
}

/**
 * Minimal CSS-variable-driven evidence panel. It renders deterministic public
 * evidence and intentionally exposes no transaction control.
 */
export function CutoutEvidencePanel({
  response,
  title = "Cutout preflight",
  className,
  style,
}: CutoutEvidencePanelProps): ReactElement {
  const baseStyle: CSSProperties = {
    color: "var(--cutout-ink, #14212b)",
    background: "var(--cutout-paper, #ffffff)",
    border: "1px solid var(--cutout-line, #d9e1e8)",
    borderRadius: "var(--cutout-radius, 8px)",
    fontFamily: "var(--cutout-font, ui-sans-serif, system-ui, sans-serif)",
    overflow: "hidden",
    ...style,
  };

  if (response.status !== "AVAILABLE") {
    return (
      <section
        className={classNames("cutout-evidence-panel", "cutout-evidence-panel--unavailable", className)}
        style={baseStyle}
        aria-labelledby="cutout-evidence-title"
        role="status"
      >
        <header style={{ padding: "16px 18px", borderBottom: "1px solid var(--cutout-line, #d9e1e8)" }}>
          <small style={{ color: "var(--cutout-muted, #637181)" }}>{response.modelVersion}</small>
          <h2 id="cutout-evidence-title" style={{ margin: "4px 0 0", fontSize: "1rem" }}>{title}</h2>
        </header>
        <div style={{ padding: "18px" }}>
          <strong style={{ color: "var(--cutout-danger, #b4232d)" }}>Evidence unavailable</strong>
          <p style={{ margin: "6px 0 0", color: "var(--cutout-muted, #637181)" }}>
            {response.error.message}
          </p>
          <code style={{ display: "block", marginTop: "12px", overflowWrap: "anywhere" }}>
            {response.error.code}
          </code>
        </div>
      </section>
    );
  }

  const firedSignals = response.signals.filter((signal) => signal.status === "FIRED");
  const decisionColor = response.riskBand === "LOW"
    ? "var(--cutout-low, #08775e)"
    : response.riskBand === "MEDIUM"
      ? "var(--cutout-medium, #996008)"
      : "var(--cutout-high, #b4232d)";

  return (
    <section
      className={classNames("cutout-evidence-panel", `cutout-evidence-panel--${response.riskBand.toLowerCase()}`, className)}
      style={baseStyle}
      aria-labelledby="cutout-evidence-title"
    >
      <header style={{ display: "flex", justifyContent: "space-between", gap: "16px", padding: "16px 18px", borderBottom: "1px solid var(--cutout-line, #d9e1e8)" }}>
        <div>
          <small style={{ color: "var(--cutout-muted, #637181)" }}>{response.modelVersion}</small>
          <h2 id="cutout-evidence-title" style={{ margin: "4px 0 0", fontSize: "1rem" }}>{title}</h2>
        </div>
        <strong style={{ color: decisionColor }}>{response.decision} · {response.riskBand}</strong>
      </header>
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1px", margin: 0, background: "var(--cutout-line, #d9e1e8)" }}>
        <div style={{ padding: "14px 18px", background: "var(--cutout-paper, #ffffff)" }}>
          <dt style={{ color: "var(--cutout-muted, #637181)", fontSize: "0.75rem" }}>Projected cohort</dt>
          <dd style={{ margin: "4px 0 0", fontWeight: 700 }}>{response.candidateCohort.projectedCohort}</dd>
        </div>
        <div style={{ padding: "14px 18px", background: "var(--cutout-paper, #ffffff)" }}>
          <dt style={{ color: "var(--cutout-muted, #637181)", fontSize: "0.75rem" }}>Source age</dt>
          <dd style={{ margin: "4px 0 0", fontWeight: 700 }}>{response.freshness.sourceAgeSeconds}s</dd>
        </div>
      </dl>
      <div style={{ padding: "16px 18px" }}>
        <strong>{firedSignals.length === 0 ? "No signal fired" : `${firedSignals.length} signal${firedSignals.length === 1 ? "" : "s"} fired`}</strong>
        {firedSignals.length > 0 ? (
          <ul style={{ margin: "10px 0 0", paddingLeft: "20px" }}>
            {firedSignals.map((signal) => <li key={signal.id}>{signal.id}: {signal.summary}</li>)}
          </ul>
        ) : null}
        <details style={{ marginTop: "14px" }}>
          <summary>Decision provenance</summary>
          <dl style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "6px 12px", margin: "12px 0 0" }}>
            <dt>Snapshot</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{response.snapshotHash}</dd>
            <dt>Decision ID</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{response.decisionId}</dd>
            <dt>Policy</dt><dd style={{ margin: 0 }}>{response.guardPolicyVersion}</dd>
          </dl>
        </details>
      </div>
    </section>
  );
}
