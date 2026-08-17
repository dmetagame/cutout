import { DataLayerError } from "../indexer/errors.js";
import type {
  PublicRpc,
  RpcBlockHeader,
  RpcEventFilter,
  RpcEventPage,
} from "../starknet/rpc.js";
import { JsonRpcClient } from "../starknet/rpc.js";
import { SpikeError } from "../starknet/errors.js";
import type {
  OperationalRpcConfig,
} from "./config.js";
import type {
  RpcProviderName,
  RpcProviderState,
} from "../indexer/types.js";

export interface RpcSelection {
  readonly provider: RpcProviderName;
  readonly rpc: PublicRpc;
  readonly degraded: boolean;
  readonly providerStates: readonly RpcProviderState[];
}

export interface RpcFailoverOptions {
  readonly expectedChainId: string;
  readonly now?: () => number;
  readonly clients?: Partial<Record<RpcProviderName, PublicRpc>>;
  readonly onProviderState?: (state: RpcProviderState) => void;
  readonly onRpcFailure?: (provider: RpcProviderName) => void;
  readonly onFailover?: (from: RpcProviderName, to: RpcProviderName) => void;
}

interface SuccessfulProbe {
  readonly ok: true;
  readonly rpc: PublicRpc;
  readonly state: RpcProviderState;
  readonly head: RpcBlockHeader;
}

interface FailedProbe {
  readonly ok: false;
  readonly state: RpcProviderState;
}

type Probe = SuccessfulProbe | FailedProbe;

function errorCode(error: unknown): string {
  if (error instanceof DataLayerError) return error.code;
  if (error instanceof SpikeError) return error.code;
  return "RPC_UNAVAILABLE";
}

function providerState(
  provider: RpcProviderName,
  status: RpcProviderState["status"],
  now: number,
  values: Partial<Omit<RpcProviderState, "provider" | "status" | "lastCheckedAt">> = {},
): RpcProviderState {
  return {
    provider,
    status,
    lastCheckedAt: now,
    lastSuccessAt: values.lastSuccessAt ?? null,
    lastErrorCode: values.lastErrorCode ?? null,
    chainId: values.chainId ?? null,
    headBlock: values.headBlock ?? null,
    headHash: values.headHash ?? null,
    headTimestamp: values.headTimestamp ?? null,
  };
}

class TrackedRpc implements PublicRpc {
  readonly provider: RpcProviderName;
  readonly delegate: PublicRpc;
  readonly onFailure: () => void;
  private failed = false;

  constructor(provider: RpcProviderName, delegate: PublicRpc, onFailure: () => void) {
    this.provider = provider;
    this.delegate = delegate;
    this.onFailure = onFailure;
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!this.failed) {
        this.failed = true;
        this.onFailure();
      }
      throw error;
    }
  }

  getChainId(): Promise<string> {
    return this.call(() => this.delegate.getChainId());
  }

  getBlockNumber(): Promise<number> {
    return this.call(() => this.delegate.getBlockNumber());
  }

  getBlock(blockNumber: number): Promise<RpcBlockHeader> {
    return this.call(() => this.delegate.getBlock(blockNumber));
  }

  getBlocks(blockNumbers: readonly number[]): Promise<readonly RpcBlockHeader[]> {
    return this.call(() => this.delegate.getBlocks(blockNumbers));
  }

  getEvents(filter: RpcEventFilter): Promise<RpcEventPage> {
    return this.call(() => this.delegate.getEvents(filter));
  }

  getClassHashAt(blockNumber: number, contractAddress: string): Promise<string> {
    return this.call(() => this.delegate.getClassHashAt(blockNumber, contractAddress));
  }

  getClass(classHash: string, blockNumber: number): Promise<unknown> {
    return this.call(() => this.delegate.getClass(classHash, blockNumber));
  }
}

/**
 * Selects one RPC for an entire sync attempt. A provider is never swapped in
 * the middle of a batch, which prevents a partial range from combining two
 * different views of the chain.
 */
export class RpcFailoverManager {
  readonly expectedChainId: string;
  readonly config: OperationalRpcConfig;
  readonly now: () => number;
  readonly clients: Record<RpcProviderName, PublicRpc>;
  readonly onProviderState: ((state: RpcProviderState) => void) | undefined;
  readonly onRpcFailure: ((provider: RpcProviderName) => void) | undefined;
  readonly onFailover: ((from: RpcProviderName, to: RpcProviderName) => void) | undefined;
  private readonly states = new Map<RpcProviderName, RpcProviderState>();
  private primarySuppressedUntil = 0;
  private forceSecondaryOnce = false;

  constructor(config: OperationalRpcConfig, options: RpcFailoverOptions) {
    this.expectedChainId = options.expectedChainId;
    this.config = config;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.onProviderState = options.onProviderState;
    this.onRpcFailure = options.onRpcFailure;
    this.onFailover = options.onFailover;
    this.clients = {
      primary:
        options.clients?.primary ??
        new JsonRpcClient(config.primaryUrl, fetch, { timeoutMs: config.timeoutMs }),
      secondary:
        options.clients?.secondary ??
        new JsonRpcClient(config.secondaryUrl, fetch, { timeoutMs: config.timeoutMs }),
    };
  }

  private publish(state: RpcProviderState): void {
    this.states.set(state.provider, state);
    try {
      this.onProviderState?.(state);
    } catch {
      // Observability must not change the data path's failure semantics.
    }
  }

  private statesInOrder(): readonly RpcProviderState[] {
    return [
      this.states.get("primary") ?? providerState("primary", "UNAVAILABLE", this.now()),
      this.states.get("secondary") ?? providerState("secondary", "UNAVAILABLE", this.now()),
    ];
  }

  getProviderStates(): readonly RpcProviderState[] {
    return this.statesInOrder();
  }

  private async probe(provider: RpcProviderName): Promise<Probe> {
    const now = this.now();
    const rpc = this.clients[provider];
    try {
      const chainId = await rpc.getChainId();
      if (chainId !== this.expectedChainId) {
        throw new SpikeError("CHAIN_ID_MISMATCH", "RPC provider is connected to another Starknet network.");
      }
      const headBlock = await rpc.getBlockNumber();
      const head = await rpc.getBlock(headBlock);
      if (head.blockNumber !== headBlock) {
        throw new SpikeError("RPC_ERROR", "RPC provider returned a mismatched head block.");
      }
      const state = providerState(provider, "HEALTHY", now, {
        lastSuccessAt: now,
        chainId,
        headBlock,
        headHash: head.blockHash,
        headTimestamp: head.timestamp,
      });
      this.publish(state);
      return { ok: true, rpc, state, head };
    } catch (error) {
      const state = providerState(provider, "UNAVAILABLE", now, {
        lastErrorCode: errorCode(error),
      });
      this.publish(state);
      try {
        this.onRpcFailure?.(provider);
      } catch {
        // Provider selection must not depend on metrics persistence.
      }
      return { ok: false, state };
    }
  }

  private markRuntimeFailure(provider: RpcProviderName): void {
    const now = this.now();
    const prior = this.states.get(provider);
    this.publish(providerState(provider, "UNAVAILABLE", now, {
      lastSuccessAt: prior?.lastSuccessAt ?? null,
      lastErrorCode: "RPC_UNAVAILABLE",
      chainId: prior?.chainId ?? null,
      headBlock: prior?.headBlock ?? null,
      headHash: prior?.headHash ?? null,
      headTimestamp: prior?.headTimestamp ?? null,
    }));
    if (provider === "primary") {
      this.primarySuppressedUntil = now + Math.ceil(this.config.maximumBackoffMs / 1_000);
      this.forceSecondaryOnce = true;
    }
    try {
      this.onRpcFailure?.(provider);
    } catch {
      // Keep the provider failure visible to the caller even if metrics fail.
    }
  }

  private async crossCheck(
    primary: SuccessfulProbe,
    secondary: SuccessfulProbe,
  ): Promise<{ readonly primaryUsable: boolean; readonly secondaryUsable: boolean }> {
    const commonBlock = Math.min(primary.head.blockNumber, secondary.head.blockNumber);
    const [leftResult, rightResult] = await Promise.allSettled([
      primary.rpc.getBlock(commonBlock),
      secondary.rpc.getBlock(commonBlock),
    ]);
    if (leftResult.status === "rejected" || rightResult.status === "rejected") {
      if (leftResult.status === "rejected") this.markRuntimeFailure("primary");
      if (rightResult.status === "rejected") this.markRuntimeFailure("secondary");
      return {
        primaryUsable: leftResult.status === "fulfilled",
        secondaryUsable: rightResult.status === "fulfilled",
      };
    }
    const left = leftResult.value;
    const right = rightResult.value;
    if (
      left.blockHash !== right.blockHash ||
      left.parentHash !== right.parentHash ||
      left.timestamp !== right.timestamp
    ) {
      const now = this.now();
      this.publish(providerState("primary", "DEGRADED", now, {
        lastSuccessAt: primary.state.lastSuccessAt,
        lastErrorCode: "INCONSISTENT_BLOCK_DATA",
        chainId: primary.state.chainId,
        headBlock: primary.state.headBlock,
        headHash: primary.state.headHash,
        headTimestamp: primary.state.headTimestamp,
      }));
      this.publish(providerState("secondary", "DEGRADED", now, {
        lastSuccessAt: secondary.state.lastSuccessAt,
        lastErrorCode: "INCONSISTENT_BLOCK_DATA",
        chainId: secondary.state.chainId,
        headBlock: secondary.state.headBlock,
        headHash: secondary.state.headHash,
        headTimestamp: secondary.state.headTimestamp,
      }));
      throw new DataLayerError(
        "INCONSISTENT_BLOCK_DATA",
        `RPC providers disagree at canonical block ${commonBlock}.`,
      );
    }
    return { primaryUsable: true, secondaryUsable: true };
  }

  async select(): Promise<RpcSelection> {
    const primary = await this.probe("primary");
    const secondary = await this.probe("secondary");
    let primaryUsable = primary.ok;
    let secondaryUsable = secondary.ok;
    if (primary.ok && secondary.ok) {
      const crossCheck = await this.crossCheck(primary, secondary);
      primaryUsable = crossCheck.primaryUsable;
      secondaryUsable = crossCheck.secondaryUsable;
    }

    const primarySuppressed = this.now() < this.primarySuppressedUntil;
    if (
      secondary.ok &&
      secondaryUsable &&
      (!primaryUsable || primarySuppressed || this.forceSecondaryOnce)
    ) {
      this.forceSecondaryOnce = false;
      try {
        this.onFailover?.("primary", "secondary");
      } catch {
        // Failover remains effective even when its metric callback fails.
      }
      return {
        provider: "secondary",
        rpc: new TrackedRpc("secondary", secondary.rpc, () => this.markRuntimeFailure("secondary")),
        degraded: true,
        providerStates: this.statesInOrder(),
      };
    }
    if (primary.ok && primaryUsable) {
      return {
        provider: "primary",
        rpc: new TrackedRpc("primary", primary.rpc, () => this.markRuntimeFailure("primary")),
        degraded: !secondaryUsable,
        providerStates: this.statesInOrder(),
      };
    }
    if (secondary.ok && secondaryUsable) {
      try {
        this.onFailover?.("primary", "secondary");
      } catch {
        // Failover remains effective even when its metric callback fails.
      }
      return {
        provider: "secondary",
        rpc: new TrackedRpc("secondary", secondary.rpc, () => this.markRuntimeFailure("secondary")),
        degraded: true,
        providerStates: this.statesInOrder(),
      };
    }
    throw new DataLayerError(
      "RPC_UNAVAILABLE",
      `Both configured Starknet RPC providers are unavailable: ${
        primary.state.lastErrorCode ?? "unknown"}/${secondary.state.lastErrorCode ?? "unknown"
      }.`,
    );
  }
}

export function createRpcFailoverManager(
  config: OperationalRpcConfig,
  expectedChainId: string,
  options: Omit<RpcFailoverOptions, "expectedChainId"> = {},
): RpcFailoverManager {
  return new RpcFailoverManager(config, { ...options, expectedChainId });
}
