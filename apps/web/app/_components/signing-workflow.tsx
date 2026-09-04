"use client";

import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleX,
  ClipboardCheck,
  Info,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import type {
  PreflightApiResponse,
  WireIntent,
  WireShieldIntent,
  WireWithdrawIntent,
} from "@cutout/api/types";
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
import { animateAmountFlip, useWorkflowMotion } from "./motion-system";

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
  | "FINAL_PREFLIGHT_LOADING"
  | "FINAL_REVIEW"
  | "WITHDRAW_ANALYSIS_COMPLETE"
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

type AnalysisAction = "shield" | "withdraw";

interface AmountChoice {
  readonly source: "ORIGINAL" | "RECOMMENDATION";
  readonly amount: string;
}

interface CoverAmountChoice {
  readonly action: AnalysisAction;
  readonly token: string;
  readonly amount: string;
}

interface IntentOverride extends CoverAmountChoice {
  readonly displayAmount: string;
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

function isSnapshotAdvance(error: UiError | null): boolean {
  return error?.code === "INDEX_CORRUPT" && /evaluation block does not match the snapshot/i.test(error.message);
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

function stateTone(state: FlowState): "neutral" | "working" | "success" | "warning" | "error" {
  if (state === "CONNECTING" || state === "PREFLIGHT_LOADING" || state === "FINAL_PREFLIGHT_LOADING" || state === "SIMULATING" || state === "SUBMITTING" || state === "RECEIPT_VERIFYING") return "working";
  if (state === "PREFLIGHT_COMPLETE" || state === "FINAL_REVIEW" || state === "WITHDRAW_ANALYSIS_COMPLETE" || state === "READY_FOR_CONFIRMATION" || state === "SUCCESS") return "success";
  if (state === "RECOMMENDATION_AVAILABLE") return "warning";
  if (state === "UNSUPPORTED_WALLET" || state === "WRONG_NETWORK" || state === "INVALID_INTENT" || state === "PREFLIGHT_UNAVAILABLE" || state === "SIMULATION_FAILED" || state === "RECEIPT_MISMATCH" || state === "USER_REJECTED" || state === "SUBMISSION_FAILED") return "error";
  return "neutral";
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
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

export function SigningWorkflow({ bootstrap }: SigningWorkflowProps) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const motionScope = useRef<HTMLDivElement>(null);
  const previousBootstrapStatus = useRef(bootstrap.status);
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
  const [action, setAction] = useState<AnalysisAction>("shield");
  const [tokenAddress, setTokenAddress] = useState(availableBootstrap?.config.tokens[0]?.address ?? "");
  const [amountInput, setAmountInput] = useState("");
  const [flexible, setFlexible] = useState(false);
  const [minimumInput, setMinimumInput] = useState("");
  const [maximumInput, setMaximumInput] = useState("");
  const [initialIntent, setInitialIntent] = useState<WireIntent | null>(null);
  const [initialPreflight, setInitialPreflight] = useState<PreflightApiResponse | null>(null);
  const [selection, setSelection] = useState<ExecutionSelection | null>(null);
  const [withdrawSelection, setWithdrawSelection] = useState<AmountChoice | null>(null);
  const [finalPreflight, setFinalPreflight] = useState<PreflightApiResponse | null>(null);
  const [plan, setPlan] = useState<GuardedDepositPlan | null>(null);
  const [simulation, setSimulation] = useState<SimulatedDepositPlan | null>(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);

  useWorkflowMotion(motionScope, state);

  useEffect(() => {
    const changed = previousBootstrapStatus.current !== bootstrap.status;
    previousBootstrapStatus.current = bootstrap.status;
    if (changed && bootstrap.status === "AVAILABLE") {
      setError(null);
      setState(capability === null ? "DISCONNECTED" : "CONNECTED");
    }
  }, [bootstrap.status, capability]);

  useEffect(() => {
    const closeDisclosure = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      const details = active instanceof HTMLElement
        ? active.closest<HTMLDetailsElement>("details[open]")
        : null;
      const disclosure = details ?? document.querySelector<HTMLDetailsElement>("details[open]");
      if (disclosure === null) return;
      disclosure.open = false;
      disclosure.querySelector<HTMLElement>("summary")?.focus();
    };
    window.addEventListener("keydown", closeDisclosure);
    return () => window.removeEventListener("keydown", closeDisclosure);
  }, []);

  const selectedToken = availableBootstrap?.config.tokens.find(
    (candidate) => candidate.address === tokenAddress,
  );

  const selectedCoverAmount = useMemo(() => {
    if (selectedToken === undefined || amountInput.trim() === "") return null;
    try {
      return parseTokenAmount(amountInput, selectedToken.decimals).toString(10);
    } catch {
      return null;
    }
  }, [amountInput, selectedToken]);

  const walletLabel = capability === null
    ? "No wallet"
    : capability.walletName;

  const setFailure = useCallback((nextState: FlowState, nextError: UiError) => {
    setState(nextState);
    setError(nextError);
  }, []);

  const clearDecision = useCallback(() => {
    setInitialIntent(null);
    setInitialPreflight(null);
    setSelection(null);
    setWithdrawSelection(null);
    setFinalPreflight(null);
    setPlan(null);
    setSimulation(null);
    setTransactionHash(null);
    setWarningAcknowledged(false);
    setError(null);
    setState(capability === null ? "DISCONNECTED" : "CONNECTED");
  }, [capability]);

  const refreshSnapshot = useCallback(() => {
    clearDecision();
    startRefresh(() => router.refresh());
  }, [clearDecision, router]);

  const selectAction = useCallback((nextAction: AnalysisAction) => {
    if (nextAction === action) return;
    setAction(nextAction);
    setAmountInput("");
    setFlexible(false);
    setMinimumInput("");
    setMaximumInput("");
    clearDecision();
  }, [action, clearDecision]);

  const selectToken = useCallback((nextToken: string) => {
    setTokenAddress(nextToken);
    setAmountInput("");
    setMinimumInput("");
    setMaximumInput("");
    clearDecision();
  }, [clearDecision]);

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

  const buildIntent = useCallback((override?: IntentOverride): WireIntent => {
    const intentToken = override === undefined
      ? selectedToken
      : availableBootstrap?.config.tokens.find((candidate) => candidate.address === override.token);
    if (availableBootstrap === null || config === null || capability === null || intentToken === undefined) {
      throw new Error("Wallet, snapshot, and token are required before preflight.");
    }
    const amount = parseTokenAmount(override?.displayAmount ?? amountInput, intentToken.decimals);
    let flexibility: WireIntent["flexibility"] = { mode: "exact" };
    if (override === undefined && flexible) {
      const min = parseTokenAmount(minimumInput, intentToken.decimals);
      const max = parseTokenAmount(maximumInput, intentToken.decimals);
      if (min > amount || amount > max || min > max) {
        throw new Error("Permitted minimum and maximum must contain the target amount.");
      }
      flexibility = { mode: "flexible", min: min.toString(10), max: max.toString(10) };
    }
    const evaluationTimestamp = nowWithOffset(clockOffset);
    const common = {
      chainId: config.chainId,
      account: accountFor(capability),
      token: intentToken.address,
      amount: amount.toString(10),
      evaluationBlock: availableBootstrap.snapshot.observedBlock,
      evaluationTimestamp,
      flexibility,
      deadline: evaluationTimestamp + 600,
    };
    return (override?.action ?? action) === "withdraw"
      ? {
          action: "withdraw",
          recipient: accountFor(capability),
          ...common,
        } satisfies WireWithdrawIntent
      : {
          action: "shield",
          ...common,
        } satisfies WireShieldIntent;
  }, [action, amountInput, availableBootstrap, capability, clockOffset, config, flexible, maximumInput, minimumInput, selectedToken]);

  const runInitialPreflight = useCallback(async (override?: IntentOverride) => {
    if (config === null || availableBootstrap === null || capability === null) return;
    setError(null);
    setState("PREFLIGHT_LOADING");
    try {
      const intent = buildIntent(override);
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
      setWithdrawSelection(null);
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

  const chooseCoverAmount = useCallback((next: CoverAmountChoice) => {
    const token = availableBootstrap?.config.tokens.find((candidate) => candidate.address === next.token);
    const displayAmount = token === undefined
      ? next.amount
      : formatTokenAmount(next.amount, token.decimals);
    setAction(next.action);
    setTokenAddress(next.token);
    setAmountInput(displayAmount);
    setFlexible(false);
    setMinimumInput("");
    setMaximumInput("");
    clearDecision();
    window.requestAnimationFrame(() => {
      document.getElementById("proposal")?.scrollIntoView({ block: "start" });
      if (capability === null) document.getElementById("connect-wallet")?.focus();
    });
    if (capability !== null) {
      void runInitialPreflight({ ...next, displayAmount });
    }
  }, [availableBootstrap, capability, clearDecision, runInitialPreflight]);

  const chooseWithdrawSelection = useCallback(async (nextSelection: AmountChoice) => {
    if (
      availableBootstrap === null ||
      initialIntent?.action !== "withdraw" ||
      initialPreflight?.status !== "AVAILABLE"
    ) return;
    setWithdrawSelection(nextSelection);
    setError(null);
    setState("FINAL_PREFLIGHT_LOADING");
    try {
      const timestamp = nowWithOffset(clockOffset);
      const final: WireWithdrawIntent = {
        ...initialIntent,
        amount: nextSelection.amount,
        evaluationBlock: availableBootstrap.snapshot.observedBlock,
        evaluationTimestamp: timestamp,
        flexibility: { mode: "exact" },
        deadline: timestamp + 600,
      };
      const result = await requestPreflight(window.fetch.bind(window), final);
      if (result.status === "CLIENT_UNAVAILABLE") {
        setFailure("PREFLIGHT_UNAVAILABLE", clientFailure(result));
        return;
      }
      setFinalPreflight(result);
      if (result.status !== "AVAILABLE") {
        setFailure("PREFLIGHT_UNAVAILABLE", result.error);
        return;
      }
      setState("WITHDRAW_ANALYSIS_COMPLETE");
    } catch (caught) {
      setFailure("PREFLIGHT_UNAVAILABLE", errorDetails(caught));
    }
  }, [availableBootstrap, clockOffset, initialIntent, initialPreflight, setFailure]);

  const chooseSelection = useCallback(async (nextSelection: ExecutionSelection) => {
    if (
      config === null ||
      availableBootstrap === null ||
      capability === null ||
      initialIntent === null ||
      initialIntent.action !== "shield" ||
      initialPreflight === null ||
      initialPreflight.status !== "AVAILABLE"
    ) return;
    setSelection(nextSelection);
    setError(null);
    setState("FINAL_PREFLIGHT_LOADING");
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

  const chooseCheckedAmount = useCallback((choice: AmountChoice) => {
    const continueWithChoice = () => {
      if (initialIntent?.action === "shield") {
        void chooseSelection({
          source: choice.source,
          action: "shield",
          token: initialIntent.token,
          amount: choice.amount,
        });
      } else if (initialIntent?.action === "withdraw") {
        void chooseWithdrawSelection(choice);
      }
    };

    if (choice.source !== "RECOMMENDATION" || selectedToken === undefined) {
      continueWithChoice();
      return;
    }

    const displayAmount = formatTokenAmount(choice.amount, selectedToken.decimals);
    animateAmountFlip(motionScope, () => setAmountInput(displayAmount), continueWithChoice);
  }, [chooseSelection, chooseWithdrawSelection, initialIntent, selectedToken]);

  const submitProposal = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runInitialPreflight();
  }, [runInitialPreflight]);

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
      <div ref={motionScope} className="app-frame motion-root">
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <Header runtimeMode={bootstrap.runtimeMode} walletLabel="Unavailable" />
        <main id="main-content" className="page-shell unavailable-page">
          <section className="unavailable-instrument" aria-labelledby="unavailable-title" data-state-reveal>
            <div className="unavailable-copy">
              <div className="state-icon state-icon-error"><CircleX size={22} aria-hidden="true" /></div>
              <p className="eyebrow" data-motion-item>Fail-closed evidence boundary</p>
              <h1 id="unavailable-title">Cutout will not decide from incomplete public state.</h1>
              <p className="lede" data-motion-item>Evidence is temporarily unavailable. No band, recommendation, simulation, or wallet action is exposed until a current canonical snapshot returns.</p>
              <div className="error-meta" data-motion-item><span className="error-code">{bootstrap.error.code}</span><span>No decision produced</span></div>
              <p className="unavailable-detail" data-motion-item>{bootstrap.error.message}</p>
              <button className="button button-secondary" type="button" onClick={refreshSnapshot} disabled={isRefreshing}><RefreshCw size={16} className={isRefreshing ? "spinner" : undefined} aria-hidden="true" /> {isRefreshing ? "Checking snapshot…" : "Check snapshot again"}</button>
            </div>
            <div className="unavailable-boundary" data-motion-item>
              <strong>What remains protected</strong>
              <ul><li>No partial LOW / MEDIUM / HIGH result</li><li>No amount recommendation</li><li>No wallet simulation or invoke call</li></ul>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const response = initialPreflight;
  const finalResponse = finalPreflight;
  const hasRecommendation = availableResponse(response) && response.recommendation?.kind === "CHANGE_AMOUNT";
  const currentDecision = finalResponse?.status === "AVAILABLE" ? finalResponse : response?.status === "AVAILABLE" ? response : null;
  const currentAction: AnalysisAction = initialIntent?.action ?? action;
  const selectedAmountLabel = selectedToken === undefined || selection === null
    ? null
    : formatTokenAmount(selection.amount, selectedToken.decimals);

  return (
    <div ref={motionScope} className="app-frame motion-root">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Header runtimeMode={bootstrap.runtimeMode} walletLabel={walletLabel} />
      <main id="main-content" className="page-shell" aria-labelledby="page-title" data-workflow-state={state}>
        <section className="page-intro">
          <h1 id="page-title" className="hero-title" data-motion-intro>Check an exact amount against current public STRK20 traffic, then stop at Ready X.</h1>
        </section>

        <CoverLedger
          bootstrap={bootstrap}
          action={action}
          tokenAddress={tokenAddress}
          selectedAmount={selectedCoverAmount}
          walletConnected={capability !== null}
          onAction={selectAction}
          onToken={selectToken}
          onChooseAmount={chooseCoverAmount}
        />

        <div className="workflow-stage">
          <div className={`workflow-grid ${currentDecision === null ? "workflow-grid-single" : ""}`}>
          <section id="proposal" className="surface workflow-surface" aria-labelledby="intent-title">
            <SurfaceHeader id="intent-title" index="Proposal" title={action === "shield" ? "Deposit" : "Withdraw"} description={action === "shield" ? "Check one exact amount before wallet simulation." : "Analysis only. This path cannot call a wallet."} />
            <form className="surface-body" onSubmit={submitProposal}>
              <div className="action-selector" role="group" aria-label="STRK20 action">
                <button className={action === "shield" ? "is-selected" : ""} type="button" aria-pressed={action === "shield"} onClick={() => selectAction("shield")}><span><strong>Deposit</strong><small>Check, review, then wallet simulation</small></span></button>
                <button className={action === "withdraw" ? "is-selected" : ""} type="button" aria-pressed={action === "withdraw"} onClick={() => selectAction("withdraw")}><span><strong>Withdraw</strong><small>Analysis only · no wallet call</small></span></button>
              </div>
              <div className={`wallet-row ${capability === null ? "wallet-row-disconnected" : "wallet-row-connected"}`} data-motion-item>
                <div className="wallet-copy">
                  <strong>{capability === null ? "No wallet connected" : "Wallet connected"}</strong>
                  <span>{capability === null ? "Connection is not authorization." : `${shortHash(capability.accountAddress)} · identity only`}</span>
                </div>
                {capability === null ? (
                  <button id="connect-wallet" className="button button-primary" type="button" onClick={connectWallet} disabled={state === "CONNECTING"}>
                    {state === "CONNECTING" ? <LoaderCircle size={16} className="spinner" aria-hidden="true" /> : null}
                    {state === "CONNECTING" ? "Connecting…" : "Connect wallet"}
                  </button>
                ) : (
                  <span className="wallet-network">Mainnet</span>
                )}
              </div>

              <div className="field-stack form-fields" data-motion-item>
                <label className="field">
                  <span className="field-label"><span>Token</span><span className="field-hint">STRK20 asset</span></span>
                  <select className="select" name="token" autoComplete="off" value={tokenAddress} onChange={(event) => selectToken(event.target.value)} disabled={state === "PREFLIGHT_LOADING" || state === "FINAL_PREFLIGHT_LOADING"} data-lenis-prevent>
                    {bootstrap.config.tokens.map((tokenOption) => (
                      <option key={tokenOption.address} value={tokenOption.address}>{tokenOption.symbol}</option>
                    ))}
                  </select>
                </label>

                <label className="field amount-field">
                  <span className="field-label"><span>Target amount</span><span className="field-hint">Base-unit safe input</span></span>
                  <div className="amount-control" data-proposal-amount>
                    <input className="input amount-input" name="amount" autoComplete="off" inputMode="decimal" value={amountInput} onChange={(event) => { setAmountInput(event.target.value); clearDecision(); }} placeholder="Enter exact amount…" data-lenis-prevent />
                    <span className="amount-token" aria-label={`Token symbol ${selectedToken?.symbol ?? ""}`}>{selectedToken?.symbol ?? ""}</span>
                  </div>
                </label>

                <label className="toggle-row" data-lenis-prevent>
                  <input type="checkbox" name="flexible" checked={flexible} onChange={(event) => { setFlexible(event.target.checked); clearDecision(); }} />
                  <span className="toggle-copy">
                    <strong>Permit amount flexibility</strong>
                    <span>Your range is authorization; Cutout will not widen it.</span>
                  </span>
                  <Info size={15} className="toggle-info" aria-hidden="true" />
                </label>

                {flexible ? (
                  <div className="range-grid">
                    <label className="field"><span className="field-label">Minimum amount</span><input className="input" name="minimum" autoComplete="off" inputMode="decimal" value={minimumInput} onChange={(event) => { setMinimumInput(event.target.value); clearDecision(); }} placeholder="Minimum permitted…" data-lenis-prevent /></label>
                    <label className="field"><span className="field-label">Maximum amount</span><input className="input" name="maximum" autoComplete="off" inputMode="decimal" value={maximumInput} onChange={(event) => { setMaximumInput(event.target.value); clearDecision(); }} placeholder="Maximum permitted…" data-lenis-prevent /></label>
                  </div>
                ) : null}
              </div>

              {error !== null && state !== "PREFLIGHT_UNAVAILABLE" ? (
                <div className="alert alert-error" role="alert"><CircleX size={17} aria-hidden="true" /><span><strong>{error.code}</strong><br />{error.message}</span></div>
              ) : null}

              <div className="button-row form-actions" data-motion-item>
                <button className={`button ${capability === null ? "button-secondary" : "button-primary"}`} type="submit" disabled={capability === null || amountInput.trim() === "" || state === "PREFLIGHT_LOADING" || state === "FINAL_PREFLIGHT_LOADING" || state === "CONNECTING"}>
                  {state === "PREFLIGHT_LOADING" ? <LoaderCircle size={16} className="spinner" aria-hidden="true" /> : null}
                  {state === "PREFLIGHT_LOADING" ? "Checking public evidence…" : action === "shield" ? "Check deposit" : "Analyze withdrawal"}
                </button>
                <button className="icon-button" type="button" title="Refresh snapshot" aria-label="Refresh snapshot" onClick={refreshSnapshot} disabled={isRefreshing}><RefreshCw size={16} className={isRefreshing ? "spinner" : undefined} aria-hidden="true" /></button>
              </div>
              <div className="form-footnote"><LockKeyhole size={14} aria-hidden="true" /><span>{action === "shield" ? "The wallet path begins only after final preflight and simulation." : "This path ends after analysis; no wallet call is possible."}</span></div>
            </form>
          </section>

          {currentDecision === null ? null : <section className="surface evidence-surface" aria-labelledby="evidence-title" data-motion-section>
            <SurfaceHeader id="evidence-title" index="Deterministic result" title="Evidence and decision" description="Decision first, then the evidence and provenance that produced it." badge={<StateBadge state={state} />} />
              <div data-state-reveal>
                <div className={`decision-hero ${bandClass(currentDecision.riskBand)}`} role="status" aria-live="polite" data-motion-item>
                  <div className="decision-hero-top"><span className="decision-kicker"><CheckCircle2 size={14} aria-hidden="true" /> {currentAction === "shield" ? "Deposit preflight" : "Withdrawal analysis"}</span><span className="decision-model">{currentDecision.modelVersion}</span></div>
                  <div className="decision-mainline"><span className={`decision-band ${bandClass(currentDecision.riskBand)}`} data-decision-band={currentDecision.riskBand}>{currentDecision.riskBand}</span><div className="decision-copy"><strong data-decision-label>{currentDecision.decision}</strong><span>Operational guard decision under GUARD_POLICY-v1</span></div></div>
                </div>
                <div className="decision-why" data-motion-item><p><strong>Why this result?</strong><span>The decision is bound to the exact amount, current snapshot, freshness thresholds, and published guard policy.</span></p></div>
                <div className="evidence-grid grid-flow-dense" data-motion-item>
                  <div className="evidence-cell evidence-cell-span-6"><span className="section-kicker">Exact matches</span><strong className="evidence-value" data-count-value={currentDecision.candidateCohort.existingMatches}>{currentDecision.candidateCohort.existingMatches}</strong><span className="evidence-subvalue">trailing 24h</span></div>
                  <div className="evidence-cell evidence-cell-span-6"><span className="section-kicker">Projected cohort</span><strong className="evidence-value" data-count-value={currentDecision.candidateCohort.projectedCohort}>{currentDecision.candidateCohort.projectedCohort}</strong><span className="evidence-subvalue">after this {currentAction === "shield" ? "deposit" : "withdrawal"}</span></div>
                  <div className="evidence-cell"><span className="section-kicker">Address diversity</span><strong className="evidence-value" data-count-value={currentDecision.cohortQuality.distinctAddresses}>{currentDecision.cohortQuality.distinctAddresses}</strong><span className="evidence-subvalue">distinct public {currentAction === "shield" ? "depositors" : "recipients"}</span></div>
                  <div className="evidence-cell"><span className="section-kicker">Source age</span><strong className="evidence-value">{currentDecision.freshness.sourceAgeSeconds}s</strong><span className="evidence-subvalue">freshness window</span></div>
                  <div className="evidence-cell"><span className="section-kicker">Index lag</span><strong className="evidence-value">{currentDecision.freshness.indexLagSeconds}s</strong><span className="evidence-subvalue">observed block {currentDecision.freshness.observedBlock.toLocaleString()}</span></div>
                </div>
                {hasRecommendation && selection === null && withdrawSelection === null && response?.status === "AVAILABLE" ? <RecommendationBlock response={response} token={selectedToken} action={currentAction} onChoose={chooseCheckedAmount} /> : null}
                {initialIntent !== null && response?.status === "AVAILABLE" && !hasRecommendation && selection === null && withdrawSelection === null ? (
                  <RecommendationAdvisory response={response} action={currentAction} onContinue={response.decision === "DENY" ? undefined : () => initialIntent.action === "shield" ? void chooseSelection({ source: "ORIGINAL", action: "shield", token: initialIntent.token, amount: initialIntent.amount }) : void chooseWithdrawSelection({ source: "ORIGINAL", amount: initialIntent.amount })} />
                ) : null}
                {selection !== null && state === "RECOMMENDATION_AVAILABLE" ? (
                  <div className="recommendation recommendation-neutral"><h3>Selected amount</h3><p>{selectedAmountLabel} {selectedToken?.symbol} will be rechecked as an exact final intent before any wallet action.</p></div>
                ) : null}
                <details className="evidence-disclosure" open data-lenis-prevent>
                  <summary><span><span className="summary-kicker">Evidence</span> Signal findings</span><span className="summary-meta">{currentDecision.signals.length} signals <ChevronDown size={15} aria-hidden="true" /></span></summary>
                  <div className="signal-list">
                    {currentDecision.signals.map((signal) => <div className={`signal-row ${signal.status === "FIRED" ? "is-fired" : ""}`} data-signal-row key={signal.id}><span className="signal-id">{signal.id}</span><span className={`signal-status ${signal.status === "FIRED" ? "signal-fired" : signal.status === "CLEAR" ? "signal-clear" : "signal-na"}`}>{signal.status}</span><span className="signal-summary">{signal.summary}</span></div>)}
                  </div>
                </details>
                <details className="evidence-disclosure technical-disclosure" data-lenis-prevent>
                  <summary><span><span className="summary-kicker">Technical</span> Snapshot provenance</span><span className="summary-meta">Hashes and policies <ChevronDown size={15} aria-hidden="true" /></span></summary>
                  <dl className="provenance-grid"><dt>Snapshot</dt><dd>{shortHash(currentDecision.snapshotHash)}</dd><dt>Observed block hash</dt><dd>{shortHash(bootstrap.snapshot.observedBlockHash)}</dd><dt>Indexed-through</dt><dd>{bootstrap.snapshot.indexedThroughBlock.toLocaleString()} · {shortHash(bootstrap.snapshot.indexedThroughHash)}</dd><dt>Engine</dt><dd>{currentDecision.modelVersion}</dd><dt>Freshness policy</dt><dd>{bootstrap.snapshot.freshnessPolicyVersion}</dd></dl>
                </details>
                <details className="evidence-disclosure nonclaims-disclosure" data-lenis-prevent><summary><span><span className="summary-kicker">Scope</span> Published non-claims</span><span className="summary-meta">Read carefully <ChevronDown size={15} aria-hidden="true" /></span></summary><ul className="nonclaims-list">{currentDecision.nonClaims.map((claim) => <li key={claim}>{claim}</li>)}</ul></details>
              </div>
          </section>}
          </div>
        </div>

        {state === "PREFLIGHT_LOADING" ? <WorkflowProgressPanel mode={selection === null ? "preflight" : "final"} /> : null}
        {state === "FINAL_PREFLIGHT_LOADING" ? <WorkflowProgressPanel mode="final" /> : null}
        {state === "PREFLIGHT_UNAVAILABLE" && error !== null ? <div className="alert alert-error alert-wide" role="alert" data-state-reveal><AlertTriangle size={17} aria-hidden="true" /><span><strong>{isSnapshotAdvance(error) ? "Snapshot changed during check" : `Evidence unavailable: ${error.code}`}</strong><br />Cutout cannot safely make this decision from the current public state.<br />{isSnapshotAdvance(error) ? "The public snapshot advanced before this result completed. Refresh it, then run a new check." : error.message}</span><button className="button button-quiet" type="button" onClick={refreshSnapshot} disabled={isRefreshing}>{isRefreshing ? "Checking…" : "Check snapshot"}</button></div> : null}
        {state === "FINAL_REVIEW" && plan !== null && finalResponse?.status === "AVAILABLE" ? <ReviewPanel plan={plan} response={finalResponse} token={selectedToken} onSimulate={() => void simulate()} /> : null}
        {state === "WITHDRAW_ANALYSIS_COMPLETE" && initialIntent?.action === "withdraw" && finalResponse?.status === "AVAILABLE" && withdrawSelection !== null ? <WithdrawBoundaryPanel intent={initialIntent} response={finalResponse} selection={withdrawSelection} token={selectedToken} snapshotHash={bootstrap.snapshot.snapshotHash} /> : null}
        {state === "SIMULATING" ? <WorkflowProgressPanel mode="simulation" /> : null}
        {state === "READY_FOR_CONFIRMATION" && plan !== null && simulation !== null ? <ConfirmationPanel plan={plan} simulation={simulation} token={selectedToken} acknowledged={warningAcknowledged} onAcknowledged={setWarningAcknowledged} onSubmit={() => void submit()} /> : null}
        {state === "RECEIPT_VERIFYING" || state === "SUBMITTED" ? <WorkflowProgressPanel mode="receipt" detail={transactionHash === null ? "Waiting for wallet response." : `Transaction ${shortHash(transactionHash)} was submitted; inclusion is not yet verified.`} /> : null}
        {state === "USER_REJECTED" || state === "SUBMISSION_FAILED" || state === "RECEIPT_MISMATCH" ? <div className="alert alert-error alert-wide" role="alert"><CircleX size={17} aria-hidden="true" /><span><strong>{error?.code ?? state}</strong><br />{error?.message ?? "The transaction was not verified as the expected deposit."}</span></div> : null}
        <footer className="footer-note"><a href="https://starkscan.co/tx/0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e" target="_blank" rel="noreferrer">Historical independently verified 0.01 STRK receipt</a><span>Public evidence only · {bootstrap.runtimeMode === "FIXTURE" ? "deterministic fixture" : "Starknet Mainnet"} · no private STRK20 state is read</span></footer>
      </main>
    </div>
  );
}

function Header({ runtimeMode, walletLabel }: { readonly runtimeMode: "MAINNET" | "FIXTURE"; readonly walletLabel: string }) {
  return (
    <header className="app-header">
      <div className="brand" translate="no">CUTOUT</div>
      <div className="header-meta"><span className="header-network"><span className="status-dot" aria-hidden="true" />{runtimeMode === "FIXTURE" ? "Fixture" : "Mainnet"}</span><span className="header-wallet">{walletLabel}</span></div>
    </header>
  );
}

function CoverLedger({
  bootstrap,
  action,
  tokenAddress,
  selectedAmount,
  walletConnected,
  onAction,
  onToken,
  onChooseAmount,
}: {
  readonly bootstrap: AvailableWebBootstrap;
  readonly action: AnalysisAction;
  readonly tokenAddress: string;
  readonly selectedAmount: string | null;
  readonly walletConnected: boolean;
  readonly onAction: (action: AnalysisAction) => void;
  readonly onToken: (token: string) => void;
  readonly onChooseAmount: (input: { readonly action: AnalysisAction; readonly token: string; readonly amount: string }) => void;
}) {
  const token = bootstrap.cover.tokens.find((candidate) => candidate.address === tokenAddress) ?? bootstrap.cover.tokens[0];
  const coverAction = token?.actions.find((candidate) => candidate.action === action);
  const rows = coverAction?.cohorts ?? [];
  if (token === undefined || coverAction === undefined) return null;

  return (
    <section className="cover-ledger" aria-labelledby="cover-title">
      <div className="cover-ledger-intro" data-motion-item>
        <h2 id="cover-title">Current public cover</h2>
        <p>Select a row to use its exact amount.</p>
        <div className="cover-proof-line" aria-label={`${Math.round(coverAction.unmatchedExactShare * 100)} percent of amounts have no prior exact match`}><strong>{Math.round(coverAction.unmatchedExactShare * 100)}%</strong><span>of observed {token.symbol} {action === "shield" ? "deposits" : "withdrawals"} had no prior exact match in 30 days.</span></div>
      </div>
      <div className="cover-ledger-panel" data-motion-item>
        <div className="cover-controls" role="group" aria-label="Cover ledger filters">
          <div className="segmented-control" aria-label="Public edge">
            <button type="button" className={action === "shield" ? "is-selected" : ""} aria-pressed={action === "shield"} onClick={() => onAction("shield")}>Deposit</button>
            <button type="button" className={action === "withdraw" ? "is-selected" : ""} aria-pressed={action === "withdraw"} onClick={() => onAction("withdraw")}>Withdraw · analysis only</button>
          </div>
          <label className="cover-token-select"><span className="sr-only">Cover token</span><select name="cover-token" autoComplete="off" value={token.address} onChange={(event) => onToken(event.target.value)} data-lenis-prevent><option value={token.address}>{token.symbol}</option>{bootstrap.cover.tokens.filter((candidate) => candidate.address !== token.address).map((candidate) => <option key={candidate.address} value={candidate.address}>{candidate.symbol}</option>)}</select></label>
        </div>
        <div className="cover-ledger-meta"><span>Current snapshot</span><span>Trailing 24h</span><span>{coverAction.trailingEvents.toLocaleString()} events</span><span>{coverAction.distinctAddresses.toLocaleString()} public actors</span><span>Block {bootstrap.cover.indexedThroughBlock.toLocaleString()}</span></div>
        <div className="cover-table-wrap" data-lenis-prevent>
          {rows.length === 0 ? <div className="cover-empty"><BarChart3 size={18} aria-hidden="true" /><strong>No current cohort rows</strong><span>Cutout will not manufacture a recommendation from an empty public edge.</span></div> : (
            <table className="cover-table"><caption className="sr-only">Top exact-amount public cohorts for {token.symbol} {action}</caption><thead><tr><th scope="col">Exact amount</th><th scope="col">Cohort</th><th scope="col">Actors</th><th scope="col">Durability</th><th scope="col">Band</th></tr></thead><tbody>{rows.map((row) => {
              const isSelected = selectedAmount === row.amount;
              const displayAmount = formatTokenAmount(row.amount, token.decimals);
              const actionLabel = walletConnected ? "Use and check" : "Select";
              return <tr className={isSelected ? "is-selected" : ""} key={row.amount} data-cover-row data-selected={isSelected ? "true" : undefined}><th scope="row"><button className="cover-row-button" type="button" aria-pressed={isSelected} aria-label={`${actionLabel} ${displayAmount} ${token.symbol}`} onClick={() => onChooseAmount({ action, token: token.address, amount: row.amount })}><span><strong>{displayAmount} {token.symbol}</strong><small>{row.existingMatches} trailing matches</small></span><span className="cover-row-cue">{isSelected ? <><Check size={14} aria-hidden="true" /> Selected</> : <>{actionLabel}<ArrowRight size={14} aria-hidden="true" /></>}</span></button></th><td data-label="Cohort">{row.projectedCohort}</td><td data-label="Actors">{row.distinctAddresses}</td><td data-label="Durability">{row.activeDays} days</td><td data-label="Band"><span className={`cover-band cover-band-${row.band.toLowerCase()}`}>{row.band}</span></td></tr>;
            })}</tbody></table>
          )}
        </div>
        <div className="cover-ledger-foot"><span>Snapshot {shortHash(bootstrap.cover.snapshotHash)}</span><span>Source age {bootstrap.cover.freshness.sourceAgeSeconds}s</span><span>{bootstrap.cover.engineVersion}</span></div>
      </div>
    </section>
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
      <div className="progress-icon" data-motion-item><LoaderCircle size={19} className="spinner" aria-hidden="true" /></div>
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
  action,
  onChoose,
}: {
  readonly response: Extract<PreflightApiResponse, { status: "AVAILABLE" }>;
  readonly token: AvailableWebBootstrap["config"]["tokens"][number] | undefined;
  readonly action: AnalysisAction;
  readonly onChoose: (selection: AmountChoice) => void;
}) {
  const recommendation = response.recommendation;
  if (recommendation === null || recommendation.kind !== "CHANGE_AMOUNT" || token === undefined) return null;
  const decimals = token.decimals;
  return (
    <div className="recommendation" data-state-reveal>
      <div className="recommendation-header"><span className="section-kicker">Within your permitted range</span><span className="recommendation-badge"><CheckCircle2 size={13} aria-hidden="true" /> Deterministic</span></div>
      <h3>{action === "shield" ? "Healthier permitted amount" : "Lower-linkage permitted amount"}</h3>
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
        <button className="button button-primary" type="button" onClick={() => onChoose({ source: "RECOMMENDATION", amount: recommendation.to })}>Use recommendation <ArrowRight size={15} aria-hidden="true" /></button>
        <button className="button button-secondary" type="button" onClick={() => onChoose({ source: "ORIGINAL", amount: recommendation.from })}>Keep proposed amount</button>
      </div>
    </div>
  );
}

function RecommendationAdvisory({
  response,
  action,
  onContinue,
}: {
  readonly response: Extract<PreflightApiResponse, { status: "AVAILABLE" }>;
  readonly action: AnalysisAction;
  readonly onContinue: (() => void) | undefined;
}) {
  const recommendation = response.recommendation;
  const title = recommendation?.kind === "WAIT"
    ? "Wait before another check"
    : response.decision === "DENY"
      ? "No permitted continuation"
      : "Review the exact amount";
  const detail = recommendation?.kind === "WAIT"
    ? `${recommendation.reason} Suggested horizon: ${Math.round(recommendation.suggestedHorizonSeconds / 60)} minutes.`
    : recommendation?.kind === "NO_SAFER_EXECUTION"
      ? recommendation.reason
      : action === "shield"
        ? "The exact amount can now be bound to a final preflight before wallet simulation."
        : "The exact amount can now be bound to a second public-data analysis. Withdrawal execution remains disabled.";
  return <div className="recommendation recommendation-neutral"><h3>{title}</h3><p>{detail}</p>{onContinue === undefined ? <span className="recommendation-stop"><LockKeyhole size={15} aria-hidden="true" /> A denied decision cannot advance to a wallet action.</span> : <button className="button button-secondary" type="button" onClick={onContinue}>{action === "shield" ? "Review exact amount" : "Revalidate withdrawal analysis"} <ArrowRight size={15} aria-hidden="true" /></button>}</div>;
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
      <SurfaceHeader id="review-title" index="Before signing" title="Final review" description="The exact action below is the only action eligible for wallet simulation." badge="FINAL INTENT" />
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
      <details className="action-disclosure" data-lenis-prevent><summary>View exact base-unit action <ChevronDown size={15} aria-hidden="true" /></summary><pre>{JSON.stringify(plan.action, null, 2)}</pre></details>
      <div className="review-boundary" data-motion-item><LockKeyhole size={16} aria-hidden="true" /><div><strong>Cutout does not sign or broadcast this transaction.</strong><span>The next step asks the connected wallet to simulate this exact action.</span></div></div>
      <div className="review-actions"><button className="button button-primary" type="button" onClick={onSimulate}><ClipboardCheck size={16} aria-hidden="true" /> Simulate in wallet</button><span className="action-note"><LockKeyhole size={14} aria-hidden="true" /> Simulation only. The wallet still controls confirmation.</span></div>
    </section>
  );
}

function WithdrawBoundaryPanel({
  intent,
  response,
  selection,
  token,
  snapshotHash,
}: {
  readonly intent: WireWithdrawIntent;
  readonly response: Extract<PreflightApiResponse, { status: "AVAILABLE" }>;
  readonly selection: AmountChoice;
  readonly token: AvailableWebBootstrap["config"]["tokens"][number] | undefined;
  readonly snapshotHash: string;
}) {
  const displayedAmount = token === undefined
    ? selection.amount
    : `${formatTokenAmount(selection.amount, token.decimals)} ${token.symbol}`;

  return (
    <section className="surface withdraw-boundary-surface" aria-labelledby="withdraw-boundary-title" data-state-reveal>
      <SurfaceHeader
        id="withdraw-boundary-title"
        index="Public-edge result"
        title="Withdrawal analysis complete"
        description="Cutout has rechecked this exact public withdrawal edge. This build stops at analysis."
        badge="ANALYSIS ONLY"
      />
      <div className="withdraw-boundary-hero" data-motion-item>
        <div>
          <span className="section-kicker">Exact amount</span>
          <strong>{displayedAmount}</strong>
        </div>
        <div className="review-decision">
          <span className={`decision-band ${bandClass(response.riskBand)}`}>{response.riskBand}</span>
          <span className="review-decision-label">{response.decision} | {response.riskBand}</span>
        </div>
      </div>
      <div className="review-block" data-motion-item>
        <dl className="review-list">
          <dt>Action</dt><dd>Withdraw · public-edge analysis</dd>
          <dt>Token</dt><dd>{token === undefined ? intent.token : `${token.symbol} · ${intent.token}`}</dd>
          <dt>Account</dt><dd>{intent.account}</dd>
          <dt>Recipient</dt><dd>{intent.recipient}</dd>
          <dt>Snapshot</dt><dd>{shortHash(snapshotHash)}</dd>
          <dt>Decision</dt><dd>{response.decision} under {response.guardPolicyVersion}</dd>
          <dt>Freshness</dt><dd>{response.freshness.sourceAgeSeconds}s source age · {response.freshness.indexLagSeconds}s index lag</dd>
        </dl>
      </div>
      <div className="review-boundary withdraw-boundary-note" data-motion-item>
        <LockKeyhole size={16} aria-hidden="true" />
        <div>
          <strong>No wallet simulation or transaction has been requested.</strong>
          <span>Cutout does not construct, simulate, confirm, or submit withdrawal actions in this build.</span>
        </div>
      </div>
      <details className="action-disclosure" data-lenis-prevent>
        <summary>View exact public analysis intent <ChevronDown size={15} aria-hidden="true" /></summary>
        <pre>{JSON.stringify({ action: intent.action, token: intent.token, amount: selection.amount, recipient: intent.recipient }, null, 2)}</pre>
      </details>
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
    <section className="surface confirmation-surface" aria-labelledby="confirmation-title" aria-live="polite" data-state-reveal>
      <SurfaceHeader id="confirmation-title" index="Wallet boundary" title="Wallet confirmation" description="Review the exact single deposit action before the wallet opens its confirmation." badge="READY FOR CONFIRMATION" />
      <div className="confirmation-hero" data-motion-item><div className="confirmation-icon"><CheckCircle2 size={24} aria-hidden="true" /></div><div><span className="section-kicker">Simulation complete</span><strong>{token === undefined ? plan.selection.amount : formatTokenAmount(plan.selection.amount, token.decimals)} {token?.symbol}</strong><span>One typed deposit · {simulation.simulation.entryPoint}</span></div></div>
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
      <div className="review-boundary confirmation-boundary" data-motion-item><LockKeyhole size={16} aria-hidden="true" /><div><strong>Ready for your confirmation</strong><span>Cutout cannot approve, broadcast, or confirm on your behalf.</span></div></div>
      <div className="review-actions"><button className="button button-primary" type="button" onClick={onSubmit} disabled={plan.warningAcknowledgementRequired && !acknowledged}>Confirm in wallet</button><span className="action-note"><LockKeyhole size={14} aria-hidden="true" /> No transaction has been submitted.</span></div>
    </section>
  );
}
