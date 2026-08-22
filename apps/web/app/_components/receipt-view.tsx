"use client";

import { ArrowLeft, Check, CheckCircle2, CircleX, Copy, ExternalLink, ReceiptText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { workflowSha256 } from "@cutout/workflow/canonical";
import {
  RECEIPT_SCHEMA_VERSION,
  type CutoutReceiptArtifact,
} from "@cutout/workflow/types";
import { useReceiptMotion } from "./motion-system";

const RECEIPT_KEYS = new Set([
  "schemaVersion",
  "transactionHash",
  "chainId",
  "pool",
  "token",
  "amount",
  "account",
  "blockNumber",
  "blockHash",
  "observedSnapshotHash",
  "engineVersion",
  "guardPolicyVersion",
  "decision",
  "selectedAmount",
  "recommendationStatus",
  "timestamp",
  "receiptId",
]);
const HASH = /^0x[0-9a-f]{64}$/;
const FELT = /^0x[0-9a-f]+$/;
const BASE_UNITS = /^[0-9]+$/;

function isReceiptArtifact(
  value: unknown,
  receiptId: string,
): value is CutoutReceiptArtifact {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.length !== RECEIPT_KEYS.size || keys.some((key) => !RECEIPT_KEYS.has(key))) {
    return false;
  }
  return (
    candidate.schemaVersion === RECEIPT_SCHEMA_VERSION &&
    candidate.receiptId === receiptId &&
    typeof candidate.transactionHash === "string" && FELT.test(candidate.transactionHash) &&
    typeof candidate.chainId === "string" && FELT.test(candidate.chainId) &&
    typeof candidate.pool === "string" && FELT.test(candidate.pool) &&
    typeof candidate.token === "string" && FELT.test(candidate.token) &&
    typeof candidate.amount === "string" && BASE_UNITS.test(candidate.amount) &&
    typeof candidate.account === "string" && FELT.test(candidate.account) &&
    typeof candidate.blockNumber === "number" &&
    Number.isSafeInteger(candidate.blockNumber) && candidate.blockNumber >= 0 &&
    typeof candidate.blockHash === "string" && FELT.test(candidate.blockHash) &&
    typeof candidate.observedSnapshotHash === "string" && FELT.test(candidate.observedSnapshotHash) &&
    typeof candidate.engineVersion === "string" &&
    typeof candidate.guardPolicyVersion === "string" &&
    (candidate.decision === "ALLOW" || candidate.decision === "WARN" || candidate.decision === "DENY") &&
    typeof candidate.selectedAmount === "string" && BASE_UNITS.test(candidate.selectedAmount) &&
    (candidate.recommendationStatus === "ORIGINAL" || candidate.recommendationStatus === "ACCEPTED") &&
    typeof candidate.timestamp === "number" &&
    Number.isSafeInteger(candidate.timestamp) && candidate.timestamp >= 0 &&
    HASH.test(receiptId)
  );
}

export function ReceiptView({ receiptId }: { readonly receiptId: string }) {
  const router = useRouter();
  const [artifact, setArtifact] = useState<CutoutReceiptArtifact | null>(null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  const motionScope = useRef<HTMLElement>(null);

  useReceiptMotion(motionScope, missing ? "missing" : artifact === null ? "loading" : "ready");

  useEffect(() => {
    let cancelled = false;
    const loadArtifact = async () => {
      try {
        if (!HASH.test(receiptId)) {
          if (!cancelled) setMissing(true);
          return;
        }
        const raw = sessionStorage.getItem(`cutout-receipt:${receiptId}`);
        if (raw === null) {
          if (!cancelled) setMissing(true);
          return;
        }
        const parsed: unknown = JSON.parse(raw);
        if (!isReceiptArtifact(parsed, receiptId)) {
          if (!cancelled) setMissing(true);
          return;
        }
        const { receiptId: storedReceiptId, ...core } = parsed;
        if (await workflowSha256(core) !== storedReceiptId) {
          if (!cancelled) setMissing(true);
          return;
        }
        if (!cancelled) setArtifact(parsed);
      } catch {
        if (!cancelled) setMissing(true);
      }
    };
    void loadArtifact();
    return () => {
      cancelled = true;
    };
  }, [receiptId]);

  const copyReceiptId = async () => {
    try {
      await navigator.clipboard.writeText(receiptId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setCopied(false);
    }
  };

  if (missing) {
    return (
      <main ref={motionScope} className="page-shell unavailable-page motion-root">
        <section className="unavailable-shell" aria-labelledby="missing-receipt-title" data-receipt-reveal><div className="state-icon state-icon-error"><CircleX size={22} /></div><p className="eyebrow">Receipt unavailable</p><h1 id="missing-receipt-title">Receipt artifact unavailable.</h1><p className="lede">This browser session does not contain an intact Cutout receipt artifact for this identifier.</p><div className="error-meta"><span className="error-code">RECEIPT_UNAVAILABLE</span><span>No success claim is shown</span></div><button className="button button-secondary" type="button" onClick={() => router.push("/")}><ArrowLeft size={15} /> Back to signing decision</button></section>
      </main>
    );
  }
  if (artifact === null) return <main ref={motionScope} className="page-shell motion-root"><section className="progress-panel" aria-live="polite" aria-busy="true" data-receipt-reveal><div className="progress-icon"><ReceiptText size={18} /></div><div className="progress-copy"><strong>Loading receipt artifact</strong><span>Checking the schema and receipt ID binding before rendering the record</span></div><div className="progress-track" aria-hidden="true"><span /></div></section></main>;

  return (
    <>
      <header className="app-header"><div className="brand"><span className="brand-mark"><ReceiptText size={17} /></span><span>CUTOUT</span><span className="brand-divider" /><span className="brand-context">Public receipt</span></div><span className="network-pill"><CheckCircle2 size={13} /> Verified public receipt</span></header>
      <main ref={motionScope} className="page-shell receipt-page motion-root">
        <section className="receipt-hero" data-receipt-reveal><div className="receipt-success-icon"><CheckCircle2 size={28} /></div><div className="receipt-hero-copy"><p className="eyebrow">Verified public evidence</p><h1>Deposit verified on Starknet.</h1><p className="lede">Cutout created this record after matching public inclusion and the exact STRK20 Deposit event. Its receipt ID binds the fields shown below.</p></div><div className="snapshot-stamp receipt-stamp"><div className="stamp-heading"><span className="stamp-label">Receipt schema</span><span className="stamp-live"><span className="status-dot" /> VERIFIED</span></div><span className="stamp-value">{artifact.schemaVersion}</span><span className="stamp-value">{artifact.receiptId.slice(0, 12)}...{artifact.receiptId.slice(-8)}</span></div></section>
        <section className="surface receipt-surface" aria-labelledby="receipt-title" data-receipt-reveal>
          <div className="surface-header"><div className="surface-heading-row"><div><span className="surface-index">PUBLIC EVIDENCE</span><h2 id="receipt-title">Transaction record</h2><p>No private notes, keys, balances, or proof material are stored in this artifact.</p></div><span className="surface-badge-text">{artifact.decision}</span></div></div>
          <div className="receipt-summary" data-receipt-reveal><div><span className="section-kicker">Transaction status</span><strong>Verified public inclusion</strong></div><div><span className="section-kicker">Action</span><strong>One STRK20 deposit</strong></div><div><span className="section-kicker">Included block</span><strong>{artifact.blockNumber.toLocaleString()}</strong></div><div><span className="section-kicker">Guard decision</span><strong>{artifact.decision} · {artifact.engineVersion}</strong></div></div>
          <div className="receipt-action-grid" data-receipt-reveal><div className="receipt-action-lead"><span className="section-kicker">Token and amount</span><strong>{artifact.amount} base units</strong><span>Token {artifact.token}</span></div><div><span className="section-kicker">Depositor</span><strong>{artifact.account}</strong></div><div><span className="section-kicker">Recommendation</span><strong>{artifact.recommendationStatus}</strong></div></div>
          <details className="evidence-disclosure receipt-disclosure" open data-lenis-prevent><summary><span><span className="summary-kicker">Provenance</span> Inclusion and decision binding</span><span className="summary-meta">Public fields <ExternalLink size={14} /></span></summary><dl className="provenance-grid"><dt>Network</dt><dd>{artifact.chainId}</dd><dt>Pool</dt><dd>{artifact.pool}</dd><dt>Block hash</dt><dd>{artifact.blockHash}</dd><dt>Observed snapshot</dt><dd>{artifact.observedSnapshotHash}</dd><dt>Guard policy</dt><dd>{artifact.guardPolicyVersion}</dd><dt>Receipt timestamp</dt><dd>{new Date(artifact.timestamp * 1_000).toLocaleString()}</dd><dt>Receipt ID</dt><dd>{artifact.receiptId}</dd></dl></details>
          <div className="review-actions" data-receipt-reveal><button className="button button-secondary" type="button" onClick={() => router.push("/")}><ArrowLeft size={15} /> Back to signing decision</button><a className="button button-secondary" href={`https://starkscan.co/tx/${artifact.transactionHash}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open explorer</a><button className="button button-quiet" type="button" onClick={() => void copyReceiptId()} data-lenis-prevent>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy receipt ID"}</button><span className="copy-status" aria-live="polite">{copied ? "Receipt ID copied." : ""}</span></div>
        </section>
        <footer className="footer-note"><span>Verified public evidence</span><span>•</span><span>No private wallet material</span><span>•</span><span>{artifact.schemaVersion}</span></footer>
      </main>
    </>
  );
}
