import { CUTOUT_MODEL, CUTOUT_MODEL_V1_4 } from "../engine/constants.js";
import { IncrementalPublicIndexer } from "../indexer/indexer.js";
import { asDataLayerError } from "../indexer/errors.js";
import type { CanonicalStore } from "../indexer/store.js";
import type { IndexerSyncResult } from "../indexer/types.js";
import type { ReviewedPoolAbi } from "../starknet/abi.js";
import type { StarknetSpikeConfig } from "../starknet/config.js";
import type { RpcSelection } from "./rpc-failover.js";

export interface IndexerSupervisorOptions {
  readonly config: StarknetSpikeConfig;
  readonly abi: ReviewedPoolAbi;
  readonly store: CanonicalStore;
  readonly intervalSeconds: number;
  readonly historyBufferSeconds?: number;
  readonly initialBackoffMs?: number;
  readonly maximumBackoffMs?: number;
  readonly modelVersion?: "CUTOUT-v1.3" | "CUTOUT-v1.4";
  readonly now?: () => number;
  readonly selectRpc: () => Promise<RpcSelection>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly onProgress?: (message: string) => void;
}

export interface SupervisorRunResult {
  readonly status: "STOPPED";
  readonly attempts: number;
  readonly lastErrorCode: string | null;
  readonly lastResult: IndexerSyncResult | null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

/** Supervises complete sync attempts with bounded exponential backoff. */
export class IndexerSupervisor {
  readonly config: StarknetSpikeConfig;
  readonly abi: ReviewedPoolAbi;
  readonly store: CanonicalStore;
  readonly intervalSeconds: number;
  readonly historyBufferSeconds: number;
  readonly initialBackoffMs: number;
  readonly maximumBackoffMs: number;
  readonly modelVersion: "CUTOUT-v1.3" | "CUTOUT-v1.4";
  readonly now: () => number;
  readonly selectRpc: () => Promise<RpcSelection>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly onProgress: ((message: string) => void) | undefined;
  private stopping = false;
  private wakeSleep: (() => void) | null = null;

  constructor(options: IndexerSupervisorOptions) {
    positive(options.intervalSeconds, "Indexer interval");
    const historyBufferSeconds = options.historyBufferSeconds ?? 10 * 60;
    const initialBackoffMs = options.initialBackoffMs ?? 1_000;
    const maximumBackoffMs = options.maximumBackoffMs ?? 30_000;
    positive(historyBufferSeconds, "History buffer");
    positive(initialBackoffMs, "Initial backoff");
    positive(maximumBackoffMs, "Maximum backoff");
    if (maximumBackoffMs < initialBackoffMs) {
      throw new Error("Maximum backoff must be greater than or equal to initial backoff.");
    }
    this.config = options.config;
    this.abi = options.abi;
    this.store = options.store;
    this.intervalSeconds = options.intervalSeconds;
    this.historyBufferSeconds = historyBufferSeconds;
    this.initialBackoffMs = initialBackoffMs;
    this.maximumBackoffMs = maximumBackoffMs;
    this.modelVersion = options.modelVersion ?? CUTOUT_MODEL.version;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.selectRpc = options.selectRpc;
    this.sleep = options.sleep ?? delay;
    this.onProgress = options.onProgress;
  }

  requestStop(): void {
    this.stopping = true;
    this.wakeSleep?.();
  }

  get isStopping(): boolean {
    return this.stopping;
  }

  async runAttempt(): Promise<IndexerSyncResult> {
    try {
      const selection = await this.selectRpc();
      const indexer = new IncrementalPublicIndexer(selection.rpc, this.store, {
        config: this.config,
        abi: this.abi,
        rpcProviderName: selection.provider,
        modelVersion: this.modelVersion,
        now: this.now,
        ...(this.onProgress === undefined ? {} : { onProgress: this.onProgress }),
      });
      return await indexer.syncOnce(
        this.now() -
          (this.modelVersion === CUTOUT_MODEL_V1_4.version
            ? CUTOUT_MODEL_V1_4.observationSeconds
            : CUTOUT_MODEL.observationSeconds) -
          this.historyBufferSeconds,
      );
    } catch (error) {
      const failure = asDataLayerError(error, "RPC_UNAVAILABLE");
      this.store.setStatus("ERROR", failure.code);
      throw failure;
    }
  }

  async run(options: { readonly once?: boolean } = {}): Promise<SupervisorRunResult> {
    let attempts = 0;
    let backoffMs = this.initialBackoffMs;
    let lastErrorCode: string | null = null;
    let lastResult: IndexerSyncResult | null = null;
    do {
      if (this.stopping) break;
      attempts += 1;
      try {
        lastResult = await this.runAttempt();
        lastErrorCode = null;
        backoffMs = this.initialBackoffMs;
        this.onProgress?.(
          `sync complete at block ${lastResult.snapshot.observedBlock}`,
        );
        if (options.once) break;
        await this.sleepInterruptibly(this.intervalSeconds * 1_000);
      } catch (error) {
        const failure = asDataLayerError(error, "RPC_UNAVAILABLE");
        lastErrorCode = failure.code;
        this.onProgress?.(`sync unavailable: ${failure.code}; retrying with bounded backoff`);
        if (options.once) break;
        await this.sleepInterruptibly(backoffMs);
        backoffMs = Math.min(this.maximumBackoffMs, backoffMs * 2);
      }
    } while (!this.stopping);
    return { status: "STOPPED", attempts, lastErrorCode, lastResult };
  }

  private async sleepInterruptibly(milliseconds: number): Promise<void> {
    if (this.stopping) return;
    await Promise.race([
      this.sleep(milliseconds),
      new Promise<void>((resolve) => {
        if (this.stopping) resolve();
        else this.wakeSleep = resolve;
      }),
    ]);
    this.wakeSleep = null;
  }
}
