"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleX,
  ClipboardCheck,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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

export function SigningWorkflow({ bootstrap }: SigningWorkflowProps) {
  const router = useRouter();
  const availableBootstrap = bootstrap.status === "AVAILABLE" ? bootstrap : null;
  const config = useMemo(
    () => (availableBootstrap === null ? null : coreConfig(availableBootstrap)),
    [availableBootstrap],
  );
  const clockOffset = availableBootstrap === null
    ? 0
    : availableBootstrap.serverNow - Math.floor(Date.now() / 1_000);
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
        <main className="page-shell">
          <div className="surface">
            <div className="empty-state">
              <strong>Public evidence is unavailable</strong>
              <span>{bootstrap.error.code}: {bootstrap.error.message}</span>
            </div>
          </div>
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
      <main className="page-shell">
        <div className="intro-row">
          <div>
            <p className="eyebrow">Signing decision</p>
            <h1>Protect your STRK20 deposit before you sign.</h1>
            <p className="lede">Cutout checks the proposed exact amount against current public candidate-cohort evidence.</p>
          </div>
          <div className="snapshot-stamp">
            <span className="stamp-label">Canonical snapshot</span>
            <span className="stamp-value">{shortHash(bootstrap.snapshot.snapshotHash)}</span>
            <span className="stamp-value">block {bootstrap.snapshot.observedBlock.toLocaleString()}</span>
          </div>
        </div>

        <div className="workflow-grid">
          <section className="surface" aria-labelledby="intent-title">
            <div className="surface-header">
              <h2 id="intent-title">Proposed shield</h2>
              <p>One token, one deposit action, one final user decision.</p>
            </div>
            <div className="surface-body">
              <div className="wallet-row">
                <div className="wallet-copy">
                  <strong>{capability === null ? "Wallet disconnected" : "Wallet connected"}</strong>
                  <span>{capability === null ? "Connect a supported Starknet wallet" : capability.accountAddress}</span>
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

              <div className="field-stack" style={{ marginTop: 20 }}>
                <label className="field">
                  <span className="field-label">Token</span>
                  <select className="select" aria-label="Token" value={tokenAddress} onChange={(event) => setTokenAddress(event.target.value)} disabled={state === "PREFLIGHT_LOADING"}>
                    {bootstrap.config.tokens.map((tokenOption) => (
                      <option key={tokenOption.address} value={tokenOption.address}>{tokenOption.symbol}</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field-label">Target amount <span className="field-hint">base-unit safe input</span></span>
                  <div className="amount-control">
                    <input className="input" aria-label="Target amount" inputMode="decimal" value={amountInput} onChange={(event) => setAmountInput(event.target.value)} placeholder="0.00" />
                    <input className="input" aria-label="Token symbol" value={selectedToken?.symbol ?? ""} readOnly />
                  </div>
                </label>

                <label className="toggle-row">
                  <input type="checkbox" checked={flexible} onChange={(event) => setFlexible(event.target.checked)} />
                  <span className="toggle-copy">
                    <strong>Permit amount flexibility</strong>
                    <span>Cutout may recommend only within these bounds.</span>
                  </span>
                </label>

                {flexible ? (
                  <div className="range-grid">
                    <label className="field">
                      <span className="field-label">Minimum</span>
                      <input className="input" aria-label="Minimum amount" inputMode="decimal" value={minimumInput} onChange={(event) => setMinimumInput(event.target.value)} />
                    </label>
                    <label className="field">
                      <span className="field-label">Maximum</span>
                      <input className="input" aria-label="Maximum amount" inputMode="decimal" value={maximumInput} onChange={(event) => setMaximumInput(event.target.value)} />
                    </label>
                  </div>
                ) : null}
              </div>

              {error !== null && state !== "PREFLIGHT_UNAVAILABLE" ? (
                <div className="alert alert-error" role="alert"><CircleX size={17} /><span><strong>{error.code}</strong><br />{error.message}</span></div>
              ) : null}

              <div className="button-row">
                <button className="button button-primary" type="button" onClick={runInitialPreflight} disabled={capability === null || state === "PREFLIGHT_LOADING" || state === "CONNECTING"}>
                  {state === "PREFLIGHT_LOADING" ? <LoaderCircle size={16} className="spinner" /> : <ShieldCheck size={16} />}
                  {state === "PREFLIGHT_LOADING" ? "Checking public evidence" : "Run Cutout check"}
                </button>
                <button className="icon-button" type="button" title="Refresh snapshot" aria-label="Refresh snapshot" onClick={() => window.location.reload()}>
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>
          </section>

          <section className="surface" aria-labelledby="evidence-title">
            <div className="surface-header">
              <h2 id="evidence-title">Cutout check</h2>
              <p>{statusLabel(state)}</p>
            </div>
            {currentDecision === null ? (
              <div className="empty-state">
                <strong>Evidence waits for a connected wallet and valid intent.</strong>
                <span>No confident decision is shown without a complete public snapshot.</span>
              </div>
            ) : (
              <>
                <div className="decision-strip">
                  <span className={`decision-band ${bandClass(currentDecision.riskBand)}`}>{currentDecision.riskBand}</span>
                  <div className="decision-copy">
                    <strong>{currentDecision.decision}</strong>
                    <span>Operational guard decision under GUARD_POLICY-v1</span>
                  </div>
                  <span className="decision-model">{currentDecision.modelVersion}</span>
                </div>
                <div className="evidence-grid">
                  <div className="evidence-cell"><span className="section-kicker">Exact matches</span><strong className="evidence-value">{currentDecision.candidateCohort.existingMatches}</strong><span className="evidence-subvalue">trailing 24h</span></div>
                  <div className="evidence-cell"><span className="section-kicker">Projected cohort</span><strong className="evidence-value">{currentDecision.candidateCohort.projectedCohort}</strong><span className="evidence-subvalue">after this deposit</span></div>
                  <div className="evidence-cell"><span className="section-kicker">Addresses</span><strong className="evidence-value">{currentDecision.cohortQuality.distinctAddresses}</strong><span className="evidence-subvalue">distinct public addresses</span></div>
                </div>
                {hasRecommendation && selection === null && response?.status === "AVAILABLE" ? (
                  <RecommendationBlock response={response} token={selectedToken} onChoose={(nextSelection) => void chooseSelection(nextSelection)} />
                ) : null}
                {initialIntent !== null && response?.status === "AVAILABLE" && !hasRecommendation && selection === null ? (
                  <div className="recommendation" style={{ background: "#f8fafb", borderColor: "var(--line)" }}>
                    <h3>No safer permitted amount</h3>
                    <p>The current intent does not have a deterministic healthier alternative inside its authorized range.</p>
                    <button className="button button-secondary" type="button" onClick={() => void chooseSelection({ source: "ORIGINAL", action: "shield", token: initialIntent.token, amount: initialIntent.amount })}>Review original amount <ArrowRight size={15} /></button>
                  </div>
                ) : null}
                {selection !== null && state === "RECOMMENDATION_AVAILABLE" ? (
                  <div className="recommendation" style={{ background: "#f8fafb", borderColor: "var(--line)" }}>
                    <h3>Selected amount</h3>
                    <p>{selectedAmountLabel} {selectedToken?.symbol} will be rechecked as an exact final intent before any wallet action.</p>
                  </div>
                ) : null}
                <div className="signal-list">
                  {currentDecision.signals.map((signal) => (
                    <div className="signal-row" key={signal.id}>
                      <span className="signal-id">{signal.id}</span>
                      <span className={`signal-status ${signal.status === "FIRED" ? "signal-fired" : signal.status === "CLEAR" ? "signal-clear" : "signal-na"}`}>{signal.status}</span>
                      <span className="signal-summary">{signal.summary}</span>
                    </div>
                  ))}
                </div>
                <div className="freshness-line">
                  <span>observed block {currentDecision.freshness.observedBlock.toLocaleString()}</span>
                  <span>source age {currentDecision.freshness.sourceAgeSeconds}s</span>
                  <span>index lag {currentDecision.freshness.indexLagSeconds}s</span>
                </div>
                <div className="nonclaims">
                  <strong>Published non-claims</strong>
                  <ul>{currentDecision.nonClaims.map((claim) => <li key={claim}>{claim}</li>)}</ul>
                </div>
              </>
            )}
          </section>
        </div>

        {state === "PREFLIGHT_UNAVAILABLE" && error !== null ? (
          <div className="alert alert-error" role="alert"><AlertTriangle size={17} /><span><strong>Evidence unavailable: {error.code}</strong><br />{error.message}</span></div>
        ) : null}

        {state === "FINAL_REVIEW" && plan !== null && finalResponse?.status === "AVAILABLE" ? (
          <ReviewPanel plan={plan} response={finalResponse} token={selectedToken} onSimulate={() => void simulate()} />
        ) : null}

        {state === "SIMULATING" ? (
          <div className="surface" style={{ marginTop: 20 }}><div className="empty-state"><LoaderCircle size={18} className="spinner" /><strong>Preparing simulation in wallet</strong><span>No transaction is being submitted.</span></div></div>
        ) : null}

        {state === "READY_FOR_CONFIRMATION" && plan !== null && simulation !== null ? (
          <ConfirmationPanel plan={plan} simulation={simulation} acknowledged={warningAcknowledged} onAcknowledged={setWarningAcknowledged} onSubmit={() => void submit()} />
        ) : null}

        {state === "RECEIPT_VERIFYING" || state === "SUBMITTED" ? (
          <div className="surface" style={{ marginTop: 20 }}><div className="empty-state"><LoaderCircle size={18} className="spinner" /><strong>Verifying public receipt</strong><span>{transactionHash === null ? "Waiting for wallet response." : `Transaction ${shortHash(transactionHash)} was submitted; inclusion is not yet verified.`}</span></div></div>
        ) : null}

        {state === "USER_REJECTED" || state === "SUBMISSION_FAILED" || state === "RECEIPT_MISMATCH" ? (
          <div className="alert alert-error" role="alert"><CircleX size={17} /><span><strong>{error?.code ?? state}</strong><br />{error?.message ?? "The transaction was not verified as the expected deposit."}</span></div>
        ) : null}

        <p className="footer-note">Public evidence only | {bootstrap.runtimeMode === "FIXTURE" ? "deterministic fixture mode" : "Starknet mainnet"} | No private STRK20 state is read.</p>
      </main>
    </>
  );
}

function Header({ runtimeMode, walletLabel }: { readonly runtimeMode: "MAINNET" | "FIXTURE"; readonly walletLabel: string }) {
  return (
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><ShieldCheck size={17} /></span><span>CUTOUT</span></div>
      <div className="header-meta"><span>{walletLabel}</span><span className="network-pill"><span className="status-dot" aria-hidden="true" />{runtimeMode === "FIXTURE" ? "Fixture" : "Starknet Mainnet"}</span></div>
    </header>
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
    <div className="recommendation">
      <h3>Safer permitted amount</h3>
      <div className="recommendation-amount">{formatTokenAmount(recommendation.to, decimals)} {token.symbol}</div>
      <p>Smallest deterministic deviation with a healthy current exact-amount cohort.</p>
      <div className="quality-line">
        <span><strong>{recommendation.cohort.existingMatches}</strong> prior matches</span>
        <span><strong>{recommendation.cohort.distinctAddresses}</strong> addresses</span>
        <span><strong>{recommendation.cohort.activeDays}</strong> active days</span>
      </div>
      <div className="button-row">
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
    <section className="surface" style={{ marginTop: 20 }} aria-labelledby="review-title">
      <div className="surface-header">
        <h2 id="review-title">Final review</h2>
        <p>The exact action below is the only action eligible for wallet simulation.</p>
      </div>
      <div className="review-block" style={{ marginTop: 20 }}>
        <dl className="review-list">
          <dt>Action</dt><dd>Shield</dd>
          <dt>Token</dt><dd>{token?.symbol ?? plan.action.token}</dd>
          <dt>Amount</dt><dd>{token === undefined ? plan.selection.amount : formatTokenAmount(plan.selection.amount, token.decimals)} {token?.symbol}</dd>
          <dt>Network</dt><dd>Starknet Mainnet</dd>
          <dt>Guard decision</dt><dd>{response.decision} | {response.riskBand}</dd>
          <dt>Snapshot</dt><dd>{shortHash(plan.snapshotHash)}</dd>
          <dt>Action shape</dt><dd>{JSON.stringify(plan.action)}</dd>
        </dl>
        <div className="freshness-line"><span>decision {shortHash(plan.decisionId)}</span><span>model {plan.modelVersion}</span><span>policy {plan.guardPolicyVersion}</span></div>
      </div>
      <div className="button-row" style={{ padding: "0 24px 22px" }}>
        <button className="button button-primary" type="button" onClick={onSimulate}><ClipboardCheck size={16} /> Simulate in wallet</button>
      </div>
    </section>
  );
}

function ConfirmationPanel({
  plan,
  simulation,
  acknowledged,
  onAcknowledged,
  onSubmit,
}: {
  readonly plan: GuardedDepositPlan;
  readonly simulation: SimulatedDepositPlan;
  readonly acknowledged: boolean;
  readonly onAcknowledged: (value: boolean) => void;
  readonly onSubmit: () => void;
}) {
  return (
    <section className="surface" style={{ marginTop: 20 }} aria-labelledby="confirmation-title">
      <div className="surface-header">
        <h2 id="confirmation-title">Wallet confirmation</h2>
        <p>Review the exact single deposit action before the wallet opens its confirmation.</p>
      </div>
      <div className="review-block" style={{ marginTop: 20 }}>
        <dl className="review-list">
          <dt>Action</dt><dd>{plan.action.type}</dd>
          <dt>Token</dt><dd>{plan.action.token}</dd>
          <dt>Amount</dt><dd>{plan.action.amount}</dd>
          <dt>Pool</dt><dd>{plan.poolAddress}</dd>
          <dt>Simulation</dt><dd>{simulation.simulation.entryPoint} | {simulation.simulation.calldataLength} calldata felts</dd>
          <dt>Snapshot</dt><dd>{shortHash(plan.snapshotHash)}</dd>
        </dl>
      </div>
      {plan.warningAcknowledgementRequired ? (
        <label className="toggle-row" style={{ margin: "18px 24px 0" }}>
          <input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledged(event.target.checked)} />
          <span className="toggle-copy"><strong>I understand this is a WARN decision.</strong><span>The wallet remains the signing authority.</span></span>
        </label>
      ) : null}
      <div className="button-row" style={{ padding: "0 24px 22px" }}>
        <button className="button button-primary" type="button" onClick={onSubmit} disabled={plan.warningAcknowledgementRequired && !acknowledged}><WalletCards size={16} /> Confirm in wallet</button>
      </div>
    </section>
  );
}
