import { CutoutEvidencePanel, useCutoutEvidence } from "@cutout/guard/react";
import type { WireIntent } from "@cutout/guard";

export function EvidenceOnlyCutout({ intent }: { readonly intent: WireIntent }) {
  const { state, check } = useCutoutEvidence();
  const response = state.status === "AVAILABLE"
    ? state.response
    : state.status === "UNAVAILABLE" && state.response.status !== "CLIENT_UNAVAILABLE"
      ? state.response
      : null;

  return (
    <section>
      <button type="button" onClick={() => void check(intent)} disabled={state.status === "CHECKING"}>
        {state.status === "CHECKING" ? "Checking public evidence" : "Run Cutout preflight"}
      </button>
      {response === null ? null : <CutoutEvidencePanel response={response} />}
    </section>
  );
}
