"use client";

import { ArrowLeft, CircleX, ExternalLink, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { CutoutReceiptArtifact } from "@cutout/workflow/types";

export function ReceiptView({ receiptId }: { readonly receiptId: string }) {
  const router = useRouter();
  const [artifact, setArtifact] = useState<CutoutReceiptArtifact | null>(null);
  const [missing, setMissing] = useState(false);

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

  if (missing) {
    return (
      <main className="page-shell">
        <div className="surface"><div className="empty-state"><CircleX size={20} /><strong>Receipt artifact unavailable</strong><span>This browser session does not contain a verified Cutout receipt for this identifier.</span><div className="button-row"><button className="button button-secondary" type="button" onClick={() => router.push("/")}><ArrowLeft size={15} /> Back to signing decision</button></div></div></div>
      </main>
    );
  }
  if (artifact === null) return <main className="page-shell"><div className="surface"><div className="empty-state">Loading verified receipt...</div></div></main>;

  return (
    <>
      <header className="app-header"><div className="brand"><span className="brand-mark"><ReceiptText size={17} /></span><span>CUTOUT</span></div><span className="network-pill">Verified public receipt</span></header>
      <main className="page-shell">
        <div className="intro-row"><div><p className="eyebrow">Versioned receipt</p><h1>Deposit verified on Starknet.</h1><p className="lede">This record contains public inclusion and event evidence for the exact action reviewed by Cutout.</p></div><div className="snapshot-stamp"><span className="stamp-label">Schema</span><span className="stamp-value">{artifact.schemaVersion}</span><span className="stamp-value">{artifact.receiptId.slice(0, 18)}...</span></div></div>
        <section className="surface" aria-labelledby="receipt-title"><div className="surface-header"><h2 id="receipt-title">Public transaction record</h2><p>No private notes, keys, balances, or proof material are stored in this artifact.</p></div><div className="review-block" style={{ marginTop: 20 }}><dl className="review-list"><dt>Transaction</dt><dd>{artifact.transactionHash}</dd><dt>Network</dt><dd>{artifact.chainId}</dd><dt>Pool</dt><dd>{artifact.pool}</dd><dt>Token</dt><dd>{artifact.token}</dd><dt>Amount</dt><dd>{artifact.amount} base units</dd><dt>Depositor</dt><dd>{artifact.account}</dd><dt>Block</dt><dd>{artifact.blockNumber} | {artifact.blockHash}</dd><dt>Snapshot</dt><dd>{artifact.observedSnapshotHash}</dd><dt>Decision</dt><dd>{artifact.decision} | {artifact.engineVersion}</dd><dt>Recommendation</dt><dd>{artifact.recommendationStatus}</dd></dl></div><div className="button-row" style={{ padding: "0 24px 22px" }}><button className="button button-secondary" type="button" onClick={() => router.push("/")}><ArrowLeft size={15} /> Back to signing decision</button><a className="button button-secondary" href={`https://starkscan.co/tx/${artifact.transactionHash}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open explorer</a></div></section>
      </main>
    </>
  );
}
