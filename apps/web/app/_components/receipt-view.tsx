"use client";

import { ArrowLeft, Check, CheckCircle2, CircleX, Copy, ExternalLink, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { CutoutReceiptArtifact } from "@cutout/workflow/types";

export function ReceiptView({ receiptId }: { readonly receiptId: string }) {
  const router = useRouter();
  const [artifact, setArtifact] = useState<CutoutReceiptArtifact | null>(null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!/^0x[0-9a-f]{64}$/.test(receiptId)) {
      setMissing(true);
      return;
    }
    const raw = sessionStorage.getItem(`cutout-receipt:${receiptId}`);
    if (raw === null) {
      setMissing(true);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as CutoutReceiptArtifact;
      if (parsed.receiptId !== receiptId || parsed.schemaVersion !== "CUTOUT_RECEIPT-v1") {
        setMissing(true);
        return;
      }
      setArtifact(parsed);
    } catch {
      setMissing(true);
    }
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
      <main className="page-shell unavailable-page">
        <section className="unavailable-shell" aria-labelledby="missing-receipt-title"><div className="state-icon state-icon-error"><CircleX size={22} /></div><p className="eyebrow">Receipt unavailable</p><h1 id="missing-receipt-title">Receipt artifact unavailable.</h1><p className="lede">This browser session does not contain a verified Cutout receipt for this identifier.</p><div className="error-meta"><span className="error-code">RECEIPT_UNAVAILABLE</span><span>No success claim is shown</span></div><button className="button button-secondary" type="button" onClick={() => router.push("/")}><ArrowLeft size={15} /> Back to signing decision</button></section>
      </main>
    );
  }
  if (artifact === null) return <main className="page-shell"><section className="progress-panel" aria-live="polite" aria-busy="true"><div className="progress-icon"><ReceiptText size={18} /></div><div className="progress-copy"><strong>Loading verified receipt</strong><span>Reading the versioned public artifact from this browser session</span></div><div className="progress-track" aria-hidden="true"><span /></div></section></main>;

  return (
    <>
      <header className="app-header"><div className="brand"><span className="brand-mark"><ReceiptText size={17} /></span><span>CUTOUT</span><span className="brand-divider" /><span className="brand-context">Public receipt</span></div><span className="network-pill"><CheckCircle2 size={13} /> Verified public receipt</span></header>
      <main className="page-shell receipt-page">
        <section className="receipt-hero reveal"><div className="receipt-success-icon"><CheckCircle2 size={28} /></div><div className="receipt-hero-copy"><p className="eyebrow">Versioned receipt</p><h1>Deposit verified on Starknet.</h1><p className="lede">This record contains public inclusion and event evidence for the exact action reviewed by Cutout.</p></div><div className="snapshot-stamp receipt-stamp"><div className="stamp-heading"><span className="stamp-label">Receipt schema</span><span className="stamp-live"><span className="status-dot" /> VERIFIED</span></div><span className="stamp-value">{artifact.schemaVersion}</span><span className="stamp-value">{artifact.receiptId.slice(0, 12)}...{artifact.receiptId.slice(-8)}</span></div></section>
        <section className="surface receipt-surface reveal reveal-delay-1" aria-labelledby="receipt-title">
          <div className="surface-header"><div className="surface-heading-row"><div><span className="surface-index">PUBLIC EVIDENCE</span><h2 id="receipt-title">Transaction record</h2><p>No private notes, keys, balances, or proof material are stored in this artifact.</p></div><span className="surface-badge-text">{artifact.decision}</span></div></div>
          <div className="receipt-summary"><div><span className="section-kicker">Transaction</span><strong>{artifact.transactionHash.slice(0, 14)}...{artifact.transactionHash.slice(-10)}</strong></div><div><span className="section-kicker">Included block</span><strong>{artifact.blockNumber.toLocaleString()}</strong></div><div><span className="section-kicker">Guard decision</span><strong>{artifact.decision} · {artifact.engineVersion}</strong></div></div>
          <div className="review-block receipt-review"><dl className="review-list"><dt>Network</dt><dd>{artifact.chainId}</dd><dt>Pool</dt><dd>{artifact.pool}</dd><dt>Token</dt><dd>{artifact.token}</dd><dt>Amount</dt><dd>{artifact.amount} base units</dd><dt>Depositor</dt><dd>{artifact.account}</dd><dt>Recommendation</dt><dd>{artifact.recommendationStatus}</dd></dl></div>
          <details className="evidence-disclosure receipt-disclosure" open><summary><span><span className="summary-kicker">Provenance</span> Inclusion and decision binding</span><span className="summary-meta">Public fields <ExternalLink size={14} /></span></summary><dl className="provenance-grid"><dt>Block hash</dt><dd>{artifact.blockHash}</dd><dt>Observed snapshot</dt><dd>{artifact.observedSnapshotHash}</dd><dt>Guard policy</dt><dd>{artifact.guardPolicyVersion}</dd><dt>Receipt timestamp</dt><dd>{new Date(artifact.timestamp * 1_000).toLocaleString()}</dd><dt>Receipt ID</dt><dd>{artifact.receiptId}</dd></dl></details>
          <div className="review-actions"><button className="button button-secondary" type="button" onClick={() => router.push("/")}><ArrowLeft size={15} /> Back to signing decision</button><a className="button button-secondary" href={`https://starkscan.co/tx/${artifact.transactionHash}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open explorer</a><button className="button button-quiet" type="button" onClick={() => void copyReceiptId()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy receipt ID"}</button><span className="copy-status" aria-live="polite">{copied ? "Receipt ID copied." : ""}</span></div>
        </section>
        <footer className="footer-note"><span>Verified public evidence</span><span>•</span><span>No private wallet material</span><span>•</span><span>{artifact.schemaVersion}</span></footer>
      </main>
    </>
  );
}
