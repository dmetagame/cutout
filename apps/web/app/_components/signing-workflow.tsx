"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleX,
  ClipboardCheck,
  Clock3,
  Database,
  Info,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import type { PreflightApiResponse } from "@cutout/api/types";
import {
  authorizeSubmission,
  createGuardedDepositPlan,
  makeFinalExactIntent,
} from "@cutout/workflow/guard";
import { formatTokenAmount, parseTokenAmount } from "@cutout/workflow/amounts";
import {
  requestPreflight,
  type PreflightClientFailure,
} from "@cutout/workflow/preflight-client";
import {
  verifyDepositReceipt,
} from "@cutout/workflow/receipt";
import type { WireShieldIntent } from "@cutout/api/types";
import type {
  ExecutionSelection,
  GuardedDepositPlan,
  SimulatedDepositPlan,
} from "@cutout/workflow/types";
import {
  simulateGuardedDeposit,
  submitAuthorizedDeposit,
  waitForGuardedReceipt,
  type WalletExecutionAccountV6Like,
} from "@cutout/starknet/wallet-execution";
import type { Address } from "@cutout/engine/types";
import type { StarknetSpikeConfig } from "@cutout/starknet/config";
import {
  discoverAndInspectWallet,
  type WalletCapabilityReady,
} from "@cutout/starknet/wallet";
import { RpcProvider } from "starknet";
import type { WebBootstrap, AvailableWebBootstrap } from "@web/lib/types";
import { useWorkflowMotion } from "./motion-system";

type FlowState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "UNSUPPORTED_WALLET"
  | "WRONG_NETWORK"
  | "INVALID_INTENT"
  | "PREFLIGHT_LOADING"
  | "PREFLIGHT_UNAVAILABLE"
  | "PREFLIGHT_COMPLETE"
  | "RECOMMENDATION_AVAILABLE"
  | "FINAL_REVIEW"
  | "SIMULATING"
  | "SIMULATION_FAILED"
  | "READY_FOR_CONFIRMATION"
  | "SUBMITTING"
  | "SUBMITTED"
  | "RECEIPT_VERIFYING"
  | "SUCCESS"
  | "RECEIPT_MISMATCH"
  | "USER_REJECTED"
  | "SUBMISSION_FAILED";

interface SigningWorkflowProps {
  readonly bootstrap: WebBootstrap;
}

interface UiError {
  readonly code: string;
  readonly message: string;
}

function coreConfig(bootstrap: AvailableWebBootstrap): StarknetSpikeConfig {
  return {
    chainId: bootstrap.config.chainId,
    rpcUrl: bootstrap.config.rpcUrl,
    poolAddress: bootstrap.config.poolAddress as Address,
    poolDeploymentBlock: bootstrap.config.poolDeploymentBlock,
    maxEventRangeBlocks: bootstrap.config.maxEventRangeBlocks,
    tokens: bootstrap.config.tokens.map((token) => ({
      address: token.address as Address,
      symbol: token.symbol,
      decimals: token.decimals,
    })),
  };
}

function nowWithOffset(offset: number): number {
  return Math.floor(Date.now() / 1_000) + offset;
}

function errorDetails(error: unknown): UiError {
  if (error !== null && typeof error === "object" && "code" in error) {
    const candidate = error as { readonly code?: unknown; readonly message?: unknown };
    return {
      code: typeof candidate.code === "string" ? candidate.code : "WORKFLOW_ERROR",
      message: typeof candidate.message === "string" ? candidate.message : String(error),
    };
  }
  return {
    code: "WORKFLOW_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

function clientFailure(error: PreflightClientFailure): UiError {
  return { code: error.code, message: error.message };
}

function bandClass(band: "LOW" | "MEDIUM" | "HIGH"): string {
  return band === "LOW" ? "band-low" : band === "MEDIUM" ? "band-medium" : "band-high";
}

function statusLabel(state: FlowState): string {
  return state.replaceAll("_", " ");
}

function accountFor(capability: WalletCapabilityReady): string {
  return capability.accountAddress;
}

function availableResponse(
  response: PreflightApiResponse | null,
): response is Extract<PreflightApiResponse, { status: "AVAILABLE" }> {
  return response?.status === "AVAILABLE";
}

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

const FLOW_STEPS = ["Propose", "Verify", "Review", "Sign"] as const;

function flowStep(state: FlowState): number {
  switch (state) {
    case "DISCONNECTED":
    case "CONNECTING":
    case "CONNECTED":
    case "UNSUPPORTED_WALLET":
    case "WRONG_NETWORK":
    case "INVALID_INTENT":
      return 0;
    case "PREFLIGHT_LOADING":
    case "PREFLIGHT_UNAVAILABLE":
    case "PREFLIGHT_COMPLETE":
    case "RECOMMENDATION_AVAILABLE":
      return 1;
    case "FINAL_REVIEW":
    case "SIMULATING":
    case "SIMULATION_FAILED":
      return 2;
    default:
      return 3;
  }
}

function stateTone(state: FlowState): "neutral" | "working" | "success" | "warning" | "error" {
  if (state === "CONNECTING" || state === "PREFLIGHT_LOADING" || state === "SIMULATING" || state === "SUBMITTING" || state === "RECEIPT_VERIFYING") return "working";
  if (state === "PREFLIGHT_COMPLETE" || state === "FINAL_REVIEW" || state === "READY_FOR_CONFIRMATION" || state === "SUCCESS") return "success";
  if (state === "RECOMMENDATION_AVAILABLE") return "warning";
  if (state === "UNSUPPORTED_WALLET" || state === "WRONG_NETWORK" || state === "INVALID_INTENT" || state === "PREFLIGHT_UNAVAILABLE" || state === "SIMULATION_FAILED" || state === "RECEIPT_MISMATCH" || state === "USER_REJECTED" || state === "SUBMISSION_FAILED") return "error";
  return "neutral";
}

function emptyStateCopy(state: FlowState): { readonly title: string; readonly body: string } {
  if (state === "CONNECTING") {
    return {
      title: "Establishing the wallet boundary",
      body: "Cutout is checking wallet capability, account, and Starknet Mainnet before any intent can be evaluated.",
    };
  }
  if (state === "CONNECTED") {
    return {
      title: "Ready for a deterministic check",
      body: "Enter the exact shield amount and permitted range. Cutout will read public evidence without asking the wallet to sign.",
    };
  }
  if (state === "PREFLIGHT_LOADING") {
    return {
      title: "Checking current public evidence",
      body: "Validating the canonical snapshot, evaluating exact-amount coverage, and applying the frozen guard policy.",
    };
  }
  return {
    title: "Connect a wallet to begin",
    body: "No confident decision is shown until wallet identity, network, intent, and a complete public snapshot are available.",
  };
}

export function SigningWorkflow({ bootstrap }: SigningWorkflowProps) {
  const router = useRouter();
  const motionScope = useRef<HTMLElement>(null);
  const availableBootstrap = bootstrap.status === "AVAILABLE" ? bootstrap : null;
  const config = useMemo(
    () => (availableBootstrap === null ? null : coreConfig(availableBootstrap)),
    [availableBootstrap],
  );
  const clockOffset = useMemo(
    () => availableBootstrap === null
      ? 0
      : availableBootstrap.serverNow - Math.floor(Date.now() / 1_000),
    [availableBootstrap],
  );
  const [state, setState] = useState<FlowState>(
    availableBootstrap === null ? "PREFLIGHT_UNAVAILABLE" : "DISCONNECTED",
  );
  const [error, setError] = useState<UiError | null>(
    bootstrap.status === "UNAVAILABLE" ? bootstrap.error : null,
  );
  const [capability, setCapability] = useState<WalletCapabilityReady | null>(null);
  const [tokenAddress, setTokenAddress] = useState(availableBootstrap?.config.tokens[0]?.address ?? "");
  const [amountInput, setAmountInput] = useState("4713.22");
  const [flexible, setFlexible] = useState(true);
  const [minimumInput, setMinimumInput] = useState("4600");
  const [maximumInput, setMaximumInput] = useState("4800");
  const [initialIntent, setInitialIntent] = useState<WireShieldIntent | null>(null);
  const [initialPreflight, setInitialPreflight] = useState<PreflightApiResponse | null>(null);
  const [selection, setSelection] = useState<ExecutionSelection | null>(null);
  const [finalPreflight, setFinalPreflight] = useState<PreflightApiResponse | null>(null);
  const [plan, setPlan] = useState<GuardedDepositPlan | null>(null);
  const [simulation, setSimulation] = useState<SimulatedDepositPlan | null>(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);

  useWorkflowMotion(motionScope, state);

  const selectedToken = availableBootstrap?.config.tokens.find(
    (candidate) => candidate.address === tokenAddress,
  );

  const walletLabel = capability === null
    ? "No wallet connected"
    : `${capability.walletName} | API ${capability.selectedApiVersion}`;

  const setFailure = useCallback((nextState: FlowState, nextError: UiError) => {
    setState(nextState);
    setError(nextError);
  }, []);

  const connectWallet = useCallback(async () => {
    if (config === null) return;
    setError(null);
    setState("CONNECTING");
    const result = await discoverAndInspectWallet(config);
    if (result.status !== "READY") {
      const nextState: FlowState = result.code === "WALLET_NETWORK_MISMATCH"
        ? "WRONG_NETWORK"
        : result.code === "BROWSER_CONTEXT_UNAVAILABLE" || result.code === "UNSUPPORTED_WALLET"
          ? "UNSUPPORTED_WALLET"
          : "PREFLIGHT_UNAVAILABLE";
      setFailure(nextState, { code: result.code, message: result.message });
      return;
    }
    setCapability(result);
    setState("CONNECTED");
  }, [config, setFailure]);

  const buildIntent = useCallback((): WireShieldIntent => {
    if (availableBootstrap === null || config === null || capability === null || selectedToken === undefined) {
      throw new Error("Wallet, snapshot, and token are required before preflight.");
    }
    const amount = parseTokenAmount(amountInput, selectedToken.decimals);
    let flexibility: WireShieldIntent["flexibility"] = { mode: "exact" };
    if (flexible) {
      const min = parseTokenAmount(minimumInput, selectedToken.decimals);
      const max = parseTokenAmount(maximumInput, selectedToken.decimals);
      if (min > amount || amount > max || min > max) {
        throw new Error("Permitted minimum and maximum must contain the target amount.");
      }
      flexibility = { mode: "flexible", min: min.toString(10), max: max.toString(10) };
    }
    const evaluationTimestamp = nowWithOffset(clockOffset);
    return {
      action: "shield",
      chainId: config.chainId,
      account: accountFor(capability),
      token: selectedToken.address,
      amount: amount.toString(10),
      evaluationBlock: availableBootstrap.snapshot.observedBlock,
      evaluationTimestamp,
      flexibility,
      deadline: evaluationTimestamp + 600,
    };
  }, [amountInput, availableBootstrap, capability, clockOffset, config, flexible, maximumInput, minimumInput, selectedToken]);

  const runInitialPreflight = useCallback(async () => {
    if (config === null || availableBootstrap === null || capability === null) return;
    setError(null);
    setState("PREFLIGHT_LOADING");
    try {
      const intent = buildIntent();
      const result = await requestPreflight(window.fetch.bind(window), intent);
      if (result.status === "CLIENT_UNAVAILABLE") {
        setInitialIntent(intent);
        setInitialPreflight(null);
        setFailure("PREFLIGHT_UNAVAILABLE", clientFailure(result));
        return;
      }
      setInitialIntent(intent);
      setInitialPreflight(result);
      setSelection(null);
      setFinalPreflight(null);
      setPlan(null);
      setSimulation(null);
      setWarningAcknowledged(false);
      if (result.status !== "AVAILABLE") {
        setFailure("PREFLIGHT_UNAVAILABLE", result.error);
        return;
      }
      setState(result.recommendation?.kind === "CHANGE_AMOUNT"
        ? "RECOMMENDATION_AVAILABLE"
        : "PREFLIGHT_COMPLETE");
    } catch (caught) {
      setFailure("INVALID_INTENT", errorDetails(caught));
    }
  }, [availableBootstrap, buildIntent, capability, config, setFailure]);

  const chooseSelection = useCallback(async (nextSelection: ExecutionSelection) => {
    if (
      config === null ||
      availableBootstrap === null ||
      capability === null ||
      initialIntent === null ||
      initialPreflight === null
    ) return;
    setSelection(nextSelection);
    setError(null);
    setState("PREFLIGHT_LOADING");
    try {
      const timestamp = nowWithOffset(clockOffset);
      const final = makeFinalExactIntent(
        initialIntent,
        nextSelection,
        availableBootstrap.snapshot,
        timestamp,
      );
      const result = await requestPreflight(window.fetch.bind(window), final);
      if (result.status === "CLIENT_UNAVAILABLE") {
        setFailure("PREFLIGHT_UNAVAILABLE", clientFailure(result));
        return;
      }
      if (result.status !== "AVAILABLE") {
        setFinalPreflight(result);
        setFailure("PREFLIGHT_UNAVAILABLE", result.error);
        return;
      }
      const guarded = await createGuardedDepositPlan({
        originalIntent: initialIntent,
        initialPreflight,
        selection: nextSelection,
        displayedAmount: nextSelection.amount,
        finalIntent: final,
        finalPreflight: result,
        snapshot: availableBootstrap.snapshot,
        wallet: {
          chainId: capability.chainId,
          accountAddress: capability.accountAddress,
          selectedApiVersion: capability.selectedApiVersion,
        },
        now: timestamp,
      }, config);
      setFinalPreflight(result);
      setPlan(guarded);
      setSimulation(null);
      setWarningAcknowledged(false);
      setState("FINAL_REVIEW");
    } catch (caught) {
      setFailure("PREFLIGHT_UNAVAILABLE", errorDetails(caught));
    }
  }, [availableBootstrap, capability, clockOffset, config, initialIntent, initialPreflight, setFailure]);

  const simulate = useCallback(async () => {
    if (plan === null || capability === null) return;
    setError(null);
    setState("SIMULATING");
    try {
      const result = await simulateGuardedDeposit(
        capability.account as WalletExecutionAccountV6Like,
        plan,
        nowWithOffset(clockOffset),
      );
      if (result.status === "FAILED") {
        setFailure("SIMULATION_FAILED", { code: result.code, message: result.message });
        return;
      }
      setSimulation(result);
      setState("READY_FOR_CONFIRMATION");
    } catch (caught) {
      setFailure("SIMULATION_FAILED", errorDetails(caught));
    }
  }, [capability, clockOffset, plan, setFailure]);

  const submit = useCallback(async () => {
    if (plan === null || simulation === null || capability === null || config === null) return;
    setError(null);
    try {
      const authorization = authorizeSubmission({
        simulated: simulation,
        explicitUserApproval: true,
        warningAcknowledged,
        now: nowWithOffset(clockOffset),
      });
      setState("SUBMITTING");
      const result = await submitAuthorizedDeposit(
        capability.account as WalletExecutionAccountV6Like,
        authorization,
      );
      if (result.status === "FAILED") {
        setFailure(result.code === "USER_REJECTED" ? "USER_REJECTED" : "SUBMISSION_FAILED", {
          code: result.code,
          message: result.message,
        });
        return;
      }
      setTransactionHash(result.transactionHash);
      setState("SUBMITTED");
      setState("RECEIPT_VERIFYING");
      const receiptResult = await waitForGuardedReceipt(
        new RpcProvider({ nodeUrl: config.rpcUrl }),
        result.transactionHash,
      );
      if (receiptResult.status === "FAILED") {
        setFailure("RECEIPT_MISMATCH", { code: receiptResult.code, message: receiptResult.message });
        return;
      }
      if (availableBootstrap === null) {
        setFailure("RECEIPT_MISMATCH", { code: "SNAPSHOT_UNAVAILABLE", message: "Snapshot boundary disappeared." });
        return;
      }
      const artifact = await verifyDepositReceipt(receiptResult.receipt, {
        transactionHash: result.transactionHash,
        chainId: plan.chainId,
        poolAddress: plan.poolAddress,
        depositSelector: availableBootstrap.depositSelector,
        token: plan.action.token,
        amount: plan.selection.amount,
        account: plan.account,
        observedSnapshotHash: plan.snapshotHash,
        engineVersion: plan.modelVersion,
        guardPolicyVersion: plan.guardPolicyVersion,
        decision: plan.decision,
        recommendationStatus: plan.selection.source === "RECOMMENDATION" ? "ACCEPTED" : "ORIGINAL",
        timestamp: nowWithOffset(clockOffset),
      });
      sessionStorage.setItem(`cutout-receipt:${artifact.receiptId}`, JSON.stringify(artifact));
      setState("SUCCESS");
      router.push(`/receipt/${artifact.receiptId}`);
    } catch (caught) {
      setFailure("RECEIPT_MISMATCH", errorDetails(caught));
    }
  }, [availableBootstrap, capability, clockOffset, config, plan, router, setFailure, simulation, warningAcknowledged]);

  if (bootstrap.status === "UNAVAILABLE") {
    return (
      <>
        <Header runtimeMode={bootstrap.runtimeMode} walletLabel="Unavailable" />
        <main ref={motionScope} className="page-shell unavailable-page motion-root">
          <section className="unavailable-shell" aria-labelledby="unavailable-title" data-state-reveal>
            <div className="state-icon state-icon-error"><CircleX size={22} /></div>
            <p className="eyebrow" data-motion-item>Evidence unavailable</p>
            <h1 id="unavailable-title">Public evidence is unavailable.</h1>
            <p className="lede" data-motion-item>Cutout cannot safely make this decision from the current public state.</p>
            <div className="error-meta" data-motion-item><span className="error-code">{bootstrap.error.code}</span><span>Fail-closed boundary</span></div>
            <p className="unavailable-detail" data-motion-item>{bootstrap.error.message}</p>
            <button className="button button-secondary" type="button" onClick={() => window.location.reload()}><RefreshCw size={16} /> Refresh snapshot</button>
          </section>
        </main>
      </>
    );
  }

  const response = initialPreflight;
  const finalResponse = finalPreflight;
  const hasRecommendation = availableResponse(response) && response.recommendation?.kind === "CHANGE_AMOUNT";
  const currentDecision = finalResponse?.status === "AVAILABLE" ? finalResponse : response?.status === "AVAILABLE" ? response : null;
  const selectedAmountLabel = selectedToken === undefined || selection === null
    ? null
    : formatTokenAmount(selection.amount, selectedToken.decimals);

  return (
    <>
      <Header runtimeMode={bootstrap.runtimeMode} walletLabel={walletLabel} />
      <main ref={motionScope} className="page-shell motion-root" aria-labelledby="page-title" data-workflow-state={state}>
        <section className="hero editorial-entry" data-motion-section>
          <div className="hero-copy">
            <div className="eyebrow-row" data-motion-intro><p className="eyebrow">Signing decision</p><span className="live-label"><Activity size={13} /> Public evidence only</span></div>
            <h1 id="page-title" className="hero-title" data-motion-intro>Protect your STRK20 deposit before you sign.</h1>
            <p className="lede" data-motion-intro>Cutout checks the proposed exact amount against current public candidate-cohort evidence.</p>
            <div className="hero-boundary" data-motion-intro>
              <InlineProofMark />
              <div><strong>Cutout decides. Your wallet signs.</strong><span>Connecting a wallet does not authorize a transaction.</span></div>
            </div>
          </div>
          <div className="hero-aside" data-motion-intro>
            <SnapshotStamp snapshot={bootstrap.snapshot} runtimeMode={bootstrap.runtimeMode} />
            <p className="hero-aside-note">A canonical public snapshot is the boundary for every decision.</p>
          </div>
        </section>

        <div className="flow-rail-shell" data-motion-intro>
          <FlowRail state={state} />
        </div>

        <div className="workflow-stage">
          <TrustMarquee bootstrap={bootstrap} />

          <div className="workflow-grid">
          <section className="surface workflow-surface" aria-labelledby="intent-title" data-motion-section>
            <SurfaceHeader id="intent-title" index="01 / Propose" title="Proposed shield" description="One token, one deposit action, one final user decision." badge="ONE ACTION" />
            <div className="surface-body">
              <div className={`wallet-row ${capability === null ? "wallet-row-disconnected" : "wallet-row-connected"}`} data-motion-item>
                <div className="wallet-status-icon"><WalletCards size={18} /></div>
                <div className="wallet-copy">
                  <strong>{capability === null ? "Wallet disconnected" : "Wallet connected"}</strong>
                  <span>{capability === null ? "Connect a supported Starknet wallet" : `${shortHash(capability.accountAddress)} · Connection only`}</span>
                </div>
                {capability === null ? (
                  <button className="button button-secondary" type="button" onClick={connectWallet} disabled={state === "CONNECTING"}>
                    {state === "CONNECTING" ? <LoaderCircle size={16} className="spinner" /> : <WalletCards size={16} />}
                    {state === "CONNECTING" ? "Connecting" : "Connect wallet"}
                  </button>
                ) : (
                  <span className="status-pill network-pill"><CheckCircle2 size={14} /> Mainnet</span>
                )}
              </div>

              <div className="field-stack form-fields" data-motion-item>
                <label className="field">
                  <span className="field-label"><span>Token</span><span className="field-hint">STRK20 asset</span></span>
                  <select className="select" aria-label="Token" value={tokenAddress} onChange={(event) => setTokenAddress(event.target.value)} disabled={state === "PREFLIGHT_LOADING"}>
                    {bootstrap.config.tokens.map((tokenOption) => (
                      <option key={tokenOption.address} value={tokenOption.address}>{tokenOption.symbol}</option>
                    ))}
                  </select>
                </label>

                <label className="field amount-field">
                  <span className="field-label"><span>Target amount</span><span className="field-hint">Base-unit safe input</span></span>
                  <div className="amount-control">
                    <input className="input amount-input" aria-label="Target amount" inputMode="decimal" value={amountInput} onChange={(event) => setAmountInput(event.target.value)} placeholder="0.00" />
                    <input className="input amount-token" aria-label="Token symbol" value={selectedToken?.symbol ?? ""} readOnly />
                  </div>
                </label>

                <label className="toggle-row">
                  <input type="checkbox" checked={flexible} onChange={(event) => setFlexible(event.target.checked)} />
                  <span className="toggle-copy">
                    <strong>Permit amount flexibility</strong>
                    <span>Your range is authorization; Cutout will not widen it.</span>
                  </span>
                  <Info size={15} className="toggle-info" aria-hidden="true" />
                </label>

                {flexible ? (
                  <div className="range-grid">
                    <label className="field"><span className="field-label">Minimum</span><input className="input" aria-label="Minimum amount" inputMode="decimal" value={minimumInput} onChange={(event) => setMinimumInput(event.target.value)} /></label>
                    <label className="field"><span className="field-label">Maximum</span><input className="input" aria-label="Maximum amount" inputMode="decimal" value={maximumInput} onChange={(event) => setMaximumInput(event.target.value)} /></label>
                  </div>
                ) : null}
              </div>

              {error !== null && state !== "PREFLIGHT_UNAVAILABLE" ? (
                <div className="alert alert-error" role="alert"><CircleX size={17} /><span><strong>{error.code}</strong><br />{error.message}</span></div>
              ) : null}

              <div className="button-row form-actions" data-motion-item>
                <button className="button button-primary" type="button" onClick={runInitialPreflight} disabled={capability === null || state === "PREFLIGHT_LOADING" || state === "CONNECTING"}>
                  {state === "PREFLIGHT_LOADING" ? <LoaderCircle size={16} className="spinner" /> : <ShieldCheck size={16} />}
                  {state === "PREFLIGHT_LOADING" ? "Checking public evidence" : "Run Cutout check"}
                </button>
                <button className="icon-button" type="button" title="Refresh snapshot" aria-label="Refresh snapshot" onClick={() => window.location.reload()}><RefreshCw size={16} /></button>
              </div>
              <div className="form-footnote"><LockKeyhole size={14} /><span>Wallet calls begin only after final preflight and simulation.</span></div>
            </div>
          </section>

          <section className="surface evidence-surface" aria-labelledby="evidence-title" data-motion-section>
            <SurfaceHeader id="evidence-title" index="02 / Verify" title="Cutout check" description="Deterministic public evidence for the exact intent." badge={<StateBadge state={state} />} />
            {currentDecision === null ? (
              <EmptyEvidence state={state} />
            ) : (
              <div data-state-reveal>
                <div className={`decision-hero ${bandClass(currentDecision.riskBand)}`} data-motion-item>
                  <div className="decision-hero-top"><span className="decision-kicker"><CheckCircle2 size={14} /> Deterministic result</span><span className="decision-model">{currentDecision.modelVersion}</span></div>
                  <div className="decision-mainline"><span className={`decision-band ${bandClass(currentDecision.riskBand)}`}>{currentDecision.riskBand}</span><div className="decision-copy"><strong>{currentDecision.decision}</strong><span>Operational guard decision under GUARD_POLICY-v1</span></div></div>
                </div>
                <div className="decision-why" data-motion-item><InlineProofMark /><p><strong>Why this result?</strong><span>The decision is bound to the exact amount, a complete snapshot, freshness thresholds, and the published guard policy.</span></p></div>
                <div className="evidence-grid grid-flow-dense" data-motion-item>
                  <div className="evidence-cell evidence-cell-span-6"><span className="section-kicker">Exact matches</span><strong className="evidence-value">{currentDecision.candidateCohort.existingMatches}</strong><span className="evidence-subvalue">trailing 24h</span></div>
                  <div className="evidence-cell evidence-cell-span-6"><span className="section-kicker">Projected cohort</span><strong className="evidence-value">{currentDecision.candidateCohort.projectedCohort}</strong><span className="evidence-subvalue">after this deposit</span></div>
                  <div className="evidence-cell"><span className="section-kicker">Address diversity</span><strong className="evidence-value">{currentDecision.cohortQuality.distinctAddresses}</strong><span className="evidence-subvalue">distinct public addresses</span></div>
                  <div className="evidence-cell"><span className="section-kicker">Source age</span><strong className="evidence-value">{currentDecision.freshness.sourceAgeSeconds}s</strong><span className="evidence-subvalue">freshness window</span></div>
                  <div className="evidence-cell"><span className="section-kicker">Index lag</span><strong className="evidence-value">{currentDecision.freshness.indexLagSeconds}s</strong><span className="evidence-subvalue">observed block {currentDecision.freshness.observedBlock.toLocaleString()}</span></div>
                </div>
                {hasRecommendation && selection === null && response?.status === "AVAILABLE" ? <RecommendationBlock response={response} token={selectedToken} onChoose={(nextSelection) => void chooseSelection(nextSelection)} /> : null}
                {initialIntent !== null && response?.status === "AVAILABLE" && !hasRecommendation && selection === null ? (
                  <div className="recommendation recommendation-neutral"><h3>No safer permitted amount</h3><p>The current intent does not have a deterministic healthier alternative inside its authorized range.</p><button className="button button-secondary" type="button" onClick={() => void chooseSelection({ source: "ORIGINAL", action: "shield", token: initialIntent.token, amount: initialIntent.amount })}>Review original amount <ArrowRight size={15} /></button></div>
                ) : null}
                {selection !== null && state === "RECOMMENDATION_AVAILABLE" ? (
                  <div className="recommendation recommendation-neutral"><h3>Selected amount</h3><p>{selectedAmountLabel} {selectedToken?.symbol} will be rechecked as an exact final intent before any wallet action.</p></div>
                ) : null}
                <details className="evidence-disclosure" open>
                  <summary><span><span className="summary-kicker">Evidence</span> Signal findings</span><span className="summary-meta">{currentDecision.signals.length} signals <ChevronDown size={15} /></span></summary>
                  <div className="signal-list">
                    {currentDecision.signals.map((signal) => <div className="signal-row" key={signal.id}><span className="signal-id">{signal.id}</span><span className={`signal-status ${signal.status === "FIRED" ? "signal-fired" : signal.status === "CLEAR" ? "signal-clear" : "signal-na"}`}>{signal.status}</span><span className="signal-summary">{signal.summary}</span></div>)}
                  </div>
                </details>
                <details className="evidence-disclosure technical-disclosure">
                  <summary><span><span className="summary-kicker">Technical</span> Snapshot provenance</span><span className="summary-meta">Hashes and policies <ChevronDown size={15} /></span></summary>
                  <dl className="provenance-grid"><dt>Snapshot</dt><dd>{shortHash(currentDecision.snapshotHash)}</dd><dt>Observed block hash</dt><dd>{shortHash(bootstrap.snapshot.observedBlockHash)}</dd><dt>Indexed-through</dt><dd>{bootstrap.snapshot.indexedThroughBlock.toLocaleString()} · {shortHash(bootstrap.snapshot.indexedThroughHash)}</dd><dt>Engine</dt><dd>{currentDecision.modelVersion}</dd><dt>Freshness policy</dt><dd>{bootstrap.snapshot.freshnessPolicyVersion}</dd></dl>
                </details>
                <details className="evidence-disclosure nonclaims-disclosure"><summary><span><span className="summary-kicker">Scope</span> Published non-claims</span><span className="summary-meta">Read carefully <ChevronDown size={15} /></span></summary><ul className="nonclaims-list">{currentDecision.nonClaims.map((claim) => <li key={claim}>{claim}</li>)}</ul></details>
              </div>
            )}
          </section>
          </div>
        </div>

        {state === "PREFLIGHT_LOADING" ? <WorkflowProgressPanel mode={selection === null ? "preflight" : "final"} /> : null}
        {state === "PREFLIGHT_UNAVAILABLE" && error !== null ? <div className="alert alert-error alert-wide" role="alert" data-state-reveal><AlertTriangle size={17} /><span><strong>Evidence unavailable: {error.code}</strong><br />Cutout cannot safely make this decision from the current public state.<br />{error.message}</span><button className="button button-quiet" type="button" onClick={() => window.location.reload()}>Refresh</button></div> : null}
        {state === "FINAL_REVIEW" && plan !== null && finalResponse?.status === "AVAILABLE" ? <ReviewPanel plan={plan} response={finalResponse} token={selectedToken} onSimulate={() => void simulate()} /> : null}
        {state === "SIMULATING" ? <WorkflowProgressPanel mode="simulation" /> : null}
        {state === "READY_FOR_CONFIRMATION" && plan !== null && simulation !== null ? <ConfirmationPanel plan={plan} simulation={simulation} token={selectedToken} acknowledged={warningAcknowledged} onAcknowledged={setWarningAcknowledged} onSubmit={() => void submit()} /> : null}
        {state === "RECEIPT_VERIFYING" || state === "SUBMITTED" ? <WorkflowProgressPanel mode="receipt" detail={transactionHash === null ? "Waiting for wallet response." : `Transaction ${shortHash(transactionHash)} was submitted; inclusion is not yet verified.`} /> : null}
        {state === "USER_REJECTED" || state === "SUBMISSION_FAILED" || state === "RECEIPT_MISMATCH" ? <div className="alert alert-error alert-wide" role="alert"><CircleX size={17} /><span><strong>{error?.code ?? state}</strong><br />{error?.message ?? "The transaction was not verified as the expected deposit."}</span></div> : null}
        <footer className="footer-note"><span>Public evidence only</span><span>•</span><span>{bootstrap.runtimeMode === "FIXTURE" ? "Deterministic fixture mode" : "Starknet Mainnet"}</span><span>•</span><span>No private STRK20 state is read</span></footer>
      </main>
    </>
  );
}

function Header({ runtimeMode, walletLabel }: { readonly runtimeMode: "MAINNET" | "FIXTURE"; readonly walletLabel: string }) {
  return (
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><ShieldCheck size={17} /></span><span>CUTOUT</span><span className="brand-divider" /><span className="brand-context">Signing guard</span></div>
      <div className="header-meta"><span className="header-wallet"><WalletCards size={14} />{walletLabel}</span><span className="network-pill"><span className="status-dot" aria-hidden="true" />{runtimeMode === "FIXTURE" ? "Fixture" : "Starknet Mainnet"}</span></div>
    </header>
  );
}

function InlineProofMark() {
  return (
    <span className="inline-proof-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function TrustMarquee({ bootstrap }: { readonly bootstrap: AvailableWebBootstrap }) {
  const items = [
    { icon: <Database size={15} />, label: "Canonical snapshot", value: bootstrap.snapshot.engineVersion },
    { icon: <Clock3 size={15} />, label: "Observed block", value: bootstrap.snapshot.observedBlock.toLocaleString() },
    { icon: <LockKeyhole size={15} />, label: "Signing boundary", value: "Wallet-owned" },
    { icon: <ShieldCheck size={15} />, label: "Decision source", value: "Public evidence" },
  ];

  return (
    <div className="trust-marquee" aria-label="Cutout guarantees" data-motion-section>
      <div className="trust-marquee-viewport">
        <div className="trust-marquee-track">
          {items.map((item) => (
            <div className="trust-marquee-item" key={item.label}>
              <span className="trust-marquee-icon">{item.icon}</span>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SnapshotStamp({
  snapshot,
  runtimeMode,
}: {
  readonly snapshot: AvailableWebBootstrap["snapshot"];
  readonly runtimeMode: "MAINNET" | "FIXTURE";
}) {
  return (
    <div className="snapshot-stamp" aria-label="Canonical snapshot" data-motion-item>
      <div className="stamp-heading"><span className="stamp-label">Canonical snapshot</span><span className={`stamp-live stamp-live-${runtimeMode.toLowerCase()}`}><span className="status-dot" /> {runtimeMode === "FIXTURE" ? "FIXTURE" : "MAINNET"}</span></div>
      <span className="stamp-value">{shortHash(snapshot.snapshotHash)}</span>
      <span className="stamp-value">block {snapshot.observedBlock.toLocaleString()}</span>
    </div>
  );
}

function FlowRail({ state }: { readonly state: FlowState }) {
  const active = flowStep(state);
  return (
    <nav className="flow-rail-nav" aria-label="Signing flow progress">
      <ol className="flow-rail">
        {FLOW_STEPS.map((step, index) => (
        <li
          className={`flow-step ${index < active ? "is-complete" : index === active ? "is-active" : ""}`}
          key={step}
          aria-current={index === active ? "step" : undefined}
        >
          <span className="flow-step-marker">{index < active ? <Check size={13} /> : String(index + 1).padStart(2, "0")}</span>
          <span className="flow-step-label">{step}</span>
          {index < FLOW_STEPS.length - 1 ? <span className="flow-step-line" aria-hidden="true"><span className="flow-step-progress" /></span> : null}
        </li>
        ))}
      </ol>
    </nav>
  );
}

function SurfaceHeader({
  id,
  index,
  title,
  description,
  badge,
}: {
  readonly id?: string;
  readonly index: string;
  readonly title: string;
  readonly description: string;
  readonly badge?: ReactNode;
}) {
  return (
    <div className="surface-header">
      <div className="surface-heading-row">
        <div><span className="surface-index">{index}</span><h2 id={id}>{title}</h2><p>{description}</p></div>
        {badge !== undefined ? <div className="surface-badge">{typeof badge === "string" ? <span className="surface-badge-text">{badge}</span> : badge}</div> : null}
      </div>
    </div>
  );
}

function StateBadge({ state }: { readonly state: FlowState }) {
  const tone = stateTone(state);
  return <span className={`state-badge state-badge-${tone}`}><span className="state-badge-dot" />{statusLabel(state)}</span>;
}

function EmptyEvidence({ state }: { readonly state: FlowState }) {
  const copy = emptyStateCopy(state);
  return (
    <div className="empty-state evidence-empty" aria-live="polite" data-state-reveal>
      <div className={`empty-icon empty-icon-${stateTone(state)}`}><ShieldCheck size={21} /></div>
      <strong data-motion-item>{copy.title}</strong>
      <span data-motion-item>{copy.body}</span>
      {state === "DISCONNECTED" ? <span className="empty-hint" data-motion-item>Your wallet remains the only signing authority.</span> : null}
    </div>
  );
}

function WorkflowProgressPanel({
  mode,
  detail,
}: {
  readonly mode: "preflight" | "final" | "simulation" | "receipt";
  readonly detail?: string;
}) {
  const content = {
    preflight: { label: "Reading latest STRK20 pool state", sublabel: "Checking snapshot freshness and exact-amount coverage" },
    final: { label: "Rechecking the final amount", sublabel: "Binding the selected action to a fresh deterministic result" },
    simulation: { label: "Building a wallet simulation", sublabel: "Preparing one typed deposit · no transaction is being submitted" },
    receipt: { label: "Verifying public receipt", sublabel: detail ?? "Waiting for independent public inclusion evidence" },
  }[mode];
  const sequence = mode === "simulation"
    ? ["Prepare one typed action", "Check wallet simulation", "Stop before confirmation"]
    : mode === "receipt"
      ? ["Read public inclusion", "Match the expected event", "Bind the receipt artifact"]
      : ["Read public state", "Validate freshness", "Evaluate policy"];
  return (
    <section className="progress-panel" aria-live="polite" aria-busy="true" data-state-reveal>
      <div className="progress-icon" data-motion-item><LoaderCircle size={19} className="spinner" /></div>
      <div className="progress-copy" data-motion-item><strong>{content.label}</strong><span>{content.sublabel}</span></div>
      <ol className="progress-sequence" aria-label="Current workflow sequence">
        {sequence.map((step) => <li key={step} data-motion-item>{step}</li>)}
      </ol>
      <div className="progress-track" aria-hidden="true"><span /></div>
    </section>
  );
}

function RecommendationBlock({
  response,
  token,
  onChoose,
}: {
  readonly response: Extract<PreflightApiResponse, { status: "AVAILABLE" }>;
  readonly token: AvailableWebBootstrap["config"]["tokens"][number] | undefined;
  readonly onChoose: (selection: ExecutionSelection) => void;
}) {
  const recommendation = response.recommendation;
  if (recommendation === null || recommendation.kind !== "CHANGE_AMOUNT" || token === undefined) return null;
  const decimals = token.decimals;
  return (
    <div className="recommendation" data-state-reveal>
      <div className="recommendation-header"><span className="section-kicker">Within your permitted range</span><span className="recommendation-badge"><CheckCircle2 size={13} /> Deterministic</span></div>
      <h3>Safer permitted amount</h3>
      <div className="recommendation-comparison" aria-label="Current proposal compared with Cutout recommendation">
        <div className="comparison-side comparison-current" data-motion-item><span>Current proposal</span><strong>{formatTokenAmount(recommendation.from, decimals)} {token.symbol}</strong><small>Evaluated against current public evidence</small></div>
        <div className="comparison-arrow" aria-hidden="true"><ArrowRight size={18} /></div>
        <div className="comparison-side comparison-recommended" data-motion-item><span>Cutout recommendation</span><strong className="recommendation-amount">{formatTokenAmount(recommendation.to, decimals)} {token.symbol}</strong><small>Inside your permitted range</small></div>
      </div>
      <p>Smallest allowed deviation with healthier public exact-amount evidence.</p>
      <div className="quality-grid" data-motion-item>
        <div><strong>{recommendation.cohort.existingMatches}</strong><span>prior matches</span></div>
        <div><strong>{recommendation.cohort.distinctAddresses}</strong><span>addresses</span></div>
        <div><strong>{recommendation.cohort.activeDays}</strong><span>active days</span></div>
      </div>
      <div className="button-row" data-motion-item>
        <button className="button button-primary" type="button" onClick={() => onChoose({ source: "RECOMMENDATION", action: "shield", token: token.address, amount: recommendation.to })}>Use recommendation <ArrowRight size={15} /></button>
        <button className="button button-secondary" type="button" onClick={() => onChoose({ source: "ORIGINAL", action: "shield", token: token.address, amount: recommendation.from })}>Keep proposed amount</button>
      </div>
    </div>
  );
}

function ReviewPanel({
  plan,
  response,
  token,
  onSimulate,
}: {
  readonly plan: GuardedDepositPlan;
  readonly response: Extract<PreflightApiResponse, { status: "AVAILABLE" }>;
  readonly token: AvailableWebBootstrap["config"]["tokens"][number] | undefined;
  readonly onSimulate: () => void;
}) {
  return (
    <section className="surface review-surface" aria-labelledby="review-title" data-state-reveal>
      <SurfaceHeader id="review-title" index="03 / Review" title="Final review" description="The exact action below is the only action eligible for wallet simulation." badge="FINAL INTENT" />
      <div className="review-hero" data-motion-item><div><span className="section-kicker">Exact action</span><strong>{token === undefined ? plan.selection.amount : formatTokenAmount(plan.selection.amount, token.decimals)} {token?.symbol}</strong></div><div className="review-decision"><span className={`decision-band ${bandClass(response.riskBand)}`}>{response.riskBand}</span><span className="review-decision-label">{response.decision} | {response.riskBand}</span></div></div>
      <div className="review-block" data-motion-item>
        <dl className="review-list">
          <dt>Action</dt><dd>Shield · one deposit</dd>
          <dt>Token</dt><dd>{token === undefined ? plan.action.token : `${token.symbol} · ${plan.action.token}`}</dd>
          <dt>Network</dt><dd>Starknet Mainnet</dd>
          <dt>Account</dt><dd>{plan.account}</dd>
          <dt>Pool</dt><dd>{plan.poolAddress}</dd>
          <dt>Snapshot</dt><dd>{shortHash(plan.snapshotHash)}</dd>
        </dl>
        <div className="freshness-line"><span>decision {shortHash(plan.decisionId)}</span><span>model {plan.modelVersion}</span><span>policy {plan.guardPolicyVersion}</span></div>
      </div>
      <details className="action-disclosure"><summary>View exact base-unit action <ChevronDown size={15} /></summary><pre>{JSON.stringify(plan.action, null, 2)}</pre></details>
      <div className="review-boundary" data-motion-item><LockKeyhole size={16} /><div><strong>Cutout does not sign or broadcast this transaction.</strong><span>The next step asks the connected wallet to simulate this exact action.</span></div></div>
      <div className="review-actions"><button className="button button-primary" type="button" onClick={onSimulate}><ClipboardCheck size={16} /> Simulate in wallet</button><span className="action-note"><LockKeyhole size={14} /> Simulation only. The wallet still controls confirmation.</span></div>
    </section>
  );
}

function ConfirmationPanel({
  plan,
  simulation,
  token,
  acknowledged,
  onAcknowledged,
  onSubmit,
}: {
  readonly plan: GuardedDepositPlan;
  readonly simulation: SimulatedDepositPlan;
  readonly token: AvailableWebBootstrap["config"]["tokens"][number] | undefined;
  readonly acknowledged: boolean;
  readonly onAcknowledged: (value: boolean) => void;
  readonly onSubmit: () => void;
}) {
  return (
    <section className="surface confirmation-surface" aria-labelledby="confirmation-title" data-state-reveal>
      <SurfaceHeader id="confirmation-title" index="04 / Sign" title="Wallet confirmation" description="Review the exact single deposit action before the wallet opens its confirmation." badge="READY FOR CONFIRMATION" />
      <div className="confirmation-hero" data-motion-item><div className="confirmation-icon"><CheckCircle2 size={24} /></div><div><span className="section-kicker">Simulation complete</span><strong>{token === undefined ? plan.selection.amount : formatTokenAmount(plan.selection.amount, token.decimals)} {token?.symbol}</strong><span>One typed deposit · {simulation.simulation.entryPoint}</span></div></div>
      <div className="confirmation-status-grid" data-motion-item><div><strong>Simulation passed</strong><span>Final action checked</span></div><div><strong>No submission</strong><span>No transaction hash exists</span></div><div><strong>User wallet</strong><span>Only authority to confirm</span></div></div>
      <div className="review-block" data-motion-item>
        <dl className="review-list">
          <dt>Action</dt><dd>{plan.action.type}</dd>
          <dt>Token</dt><dd>{token === undefined ? plan.action.token : `${token.symbol} · ${plan.action.token}`}</dd>
          <dt>Amount</dt><dd>{plan.action.amount} base units</dd>
          <dt>Account</dt><dd>{plan.account}</dd>
          <dt>Pool</dt><dd>{plan.poolAddress}</dd>
          <dt>Simulation</dt><dd>{simulation.simulation.entryPoint} · {simulation.simulation.calldataLength} calldata felts</dd>
          <dt>Snapshot</dt><dd>{shortHash(plan.snapshotHash)}</dd>
        </dl>
      </div>
      {plan.warningAcknowledgementRequired ? (
        <label className="toggle-row warning-toggle">
          <input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledged(event.target.checked)} />
          <span className="toggle-copy"><strong>I understand this is a WARN decision.</strong><span>The wallet remains the signing authority.</span></span>
        </label>
      ) : null}
      <div className="review-boundary confirmation-boundary" data-motion-item><LockKeyhole size={16} /><div><strong>Ready for your confirmation</strong><span>Cutout cannot approve, broadcast, or confirm on your behalf.</span></div></div>
      <div className="review-actions"><button className="button button-primary" type="button" onClick={onSubmit} disabled={plan.warningAcknowledgementRequired && !acknowledged}><WalletCards size={16} /> Confirm in wallet</button><span className="action-note"><LockKeyhole size={14} /> No transaction has been submitted.</span></div>
    </section>
  );
}
