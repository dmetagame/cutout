import { SpikeError } from "./errors.js";
import { normalizeFelt, normalizeTransactionHash } from "./felt.js";

export interface RpcBlockHeader {
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly parentHash: string;
  readonly timestamp: number;
  readonly status: string;
}

export interface RpcEvent {
  readonly block_hash: string;
  readonly block_number: number;
  readonly data: readonly string[];
  readonly from_address: string;
  readonly keys: readonly string[];
  readonly transaction_hash: string;
}

export interface RpcEventFilter {
  readonly from_block: { readonly block_number: number };
  readonly to_block: { readonly block_number: number };
  readonly address: string;
  readonly keys: readonly (readonly string[])[];
  readonly chunk_size: number;
  readonly continuation_token?: string;
}

export interface RpcEventPage {
  readonly events: readonly RpcEvent[];
  readonly continuationToken?: string;
}

export interface PublicRpc {
  getChainId(): Promise<string>;
  getBlockNumber(): Promise<number>;
  getBlock(blockNumber: number): Promise<RpcBlockHeader>;
  getBlocks(blockNumbers: readonly number[]): Promise<readonly RpcBlockHeader[]>;
  getEvents(filter: RpcEventFilter): Promise<RpcEventPage>;
  getClassHashAt(blockNumber: number, contractAddress: string): Promise<string>;
  getClass(classHash: string, blockNumber: number): Promise<unknown>;
}

interface JsonRpcSuccess<T> {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly result: T;
}

interface JsonRpcFailure {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function rpcFailure(method: string, response: JsonRpcResponse<unknown>): never {
  if ("error" in response) {
    throw new SpikeError("RPC_ERROR", `${method} failed: ${response.error.message}`);
  }
  throw new SpikeError("RPC_ERROR", `${method} returned an invalid response.`);
}

function parseBlock(value: unknown, blockNumber: number): RpcBlockHeader {
  if (!isRecord(value)) {
    throw new SpikeError("RPC_ERROR", `Block ${blockNumber} was not an object.`);
  }
  const blockHash = normalizeFelt(value.block_hash, `block ${blockNumber} hash`);
  const parentHash = normalizeFelt(value.parent_hash, `block ${blockNumber} parent hash`);
  const timestamp = value.timestamp;
  if (
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0
  ) {
    throw new SpikeError("RPC_ERROR", `Block ${blockNumber} has no valid timestamp.`);
  }
  const status = typeof value.status === "string" ? value.status : "UNKNOWN";
  return { blockNumber, blockHash, parentHash, timestamp, status };
}

function parseEvents(value: unknown): RpcEventPage {
  if (!isRecord(value) || !Array.isArray(value.events)) {
    throw new SpikeError("RPC_ERROR", "starknet_getEvents returned an invalid page.");
  }
  const events = value.events.map((event, index) => {
    if (!isRecord(event)) {
      throw new SpikeError("RPC_ERROR", `Event ${index} was not an object.`);
    }
    if (
      typeof event.block_number !== "number" ||
      !Number.isSafeInteger(event.block_number) ||
      !Array.isArray(event.keys) ||
      !Array.isArray(event.data) ||
      typeof event.from_address !== "string" ||
      typeof event.transaction_hash !== "string" ||
      typeof event.block_hash !== "string"
    ) {
      throw new SpikeError("RPC_ERROR", `Event ${index} has an invalid shape.`);
    }
    return {
      block_hash: normalizeFelt(event.block_hash, `event ${index} block hash`),
      block_number: event.block_number,
      data: event.data.map((item, dataIndex) => {
        if (typeof item !== "string") {
          throw new SpikeError("RPC_ERROR", `Event ${index} data ${dataIndex} is not a string.`);
        }
        return item;
      }),
      from_address: normalizeFelt(event.from_address, `event ${index} source`),
      keys: event.keys.map((item, keyIndex) => {
        if (typeof item !== "string") {
          throw new SpikeError("RPC_ERROR", `Event ${index} key ${keyIndex} is not a string.`);
        }
        return item;
      }),
      transaction_hash: normalizeTransactionHash(
        event.transaction_hash,
        `event ${index} transaction hash`,
      ),
    } satisfies RpcEvent;
  });
  const continuationToken =
    typeof value.continuation_token === "string"
      ? value.continuation_token
      : undefined;
  return continuationToken === undefined ? { events } : { events, continuationToken };
}

export class JsonRpcClient implements PublicRpc {
  readonly url: string;
  readonly fetcher: typeof fetch;
  readonly timeoutMs: number;

  constructor(
    url: string,
    fetcher: typeof fetch = fetch,
    options: { readonly timeoutMs?: number } = {},
  ) {
    this.url = url;
    this.fetcher = fetcher;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new SpikeError("RPC_ERROR", "RPC timeout must be a positive integer.");
    }
  }

  private async call<T>(method: string, params: readonly unknown[]): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Cutout/0.1 mainnet spike",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new SpikeError(
        "RPC_ERROR",
        `${method} transport failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new SpikeError("RPC_ERROR", `${method} returned HTTP ${response.status}.`);
    }
    let payload: JsonRpcResponse<T>;
    try {
      payload = (await response.json()) as JsonRpcResponse<T>;
    } catch (error) {
      throw new SpikeError(
        "RPC_ERROR",
        `${method} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if ("error" in payload) rpcFailure(method, payload as JsonRpcResponse<unknown>);
    if (!("result" in payload)) {
      throw new SpikeError("RPC_ERROR", `${method} returned no result.`);
    }
    return payload.result;
  }

  private async batch<T>(
    calls: readonly { readonly method: string; readonly params: readonly unknown[] }[],
  ): Promise<readonly T[]> {
    let response: Response;
    try {
      response = await this.fetcher(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Cutout/0.1 mainnet spike",
        },
        body: JSON.stringify(
          calls.map((call, index) => ({
            jsonrpc: "2.0",
            id: index,
            method: call.method,
            params: call.params,
          })),
        ),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new SpikeError(
        "RPC_ERROR",
        `JSON-RPC batch transport failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new SpikeError("RPC_ERROR", `JSON-RPC batch returned HTTP ${response.status}.`);
    }
    let payload: readonly JsonRpcResponse<T>[];
    try {
      payload = (await response.json()) as readonly JsonRpcResponse<T>[];
    } catch (error) {
      throw new SpikeError(
        "RPC_ERROR",
        `JSON-RPC batch returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!Array.isArray(payload) || payload.length !== calls.length) {
      throw new SpikeError("RPC_ERROR", "JSON-RPC batch was incomplete.");
    }
    return calls.map((call, index) => {
      const item = payload.find((candidate) => candidate.id === index);
      if (item === undefined || "error" in item || !("result" in item)) {
        if (item !== undefined) rpcFailure(call.method, item as JsonRpcResponse<unknown>);
        throw new SpikeError("RPC_ERROR", `${call.method} batch response was missing.`);
      }
      return item.result;
    });
  }

  async getChainId(): Promise<string> {
    return normalizeFelt(await this.call<string>("starknet_chainId", []), "chain id");
  }

  async getBlockNumber(): Promise<number> {
    const value = await this.call<unknown>("starknet_blockNumber", []);
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new SpikeError("RPC_ERROR", "starknet_blockNumber returned an invalid block.");
    }
    return value;
  }

  async getBlock(blockNumber: number): Promise<RpcBlockHeader> {
    return parseBlock(
      await this.call("starknet_getBlockWithTxHashes", [{ block_number: blockNumber }]),
      blockNumber,
    );
  }

  async getBlocks(blockNumbers: readonly number[]): Promise<readonly RpcBlockHeader[]> {
    if (blockNumbers.length === 0) return [];
    const unique = [...new Set(blockNumbers)];
    const headers: RpcBlockHeader[] = [];
    for (let offset = 0; offset < unique.length; offset += 100) {
      const batch = unique.slice(offset, offset + 100);
      const values = await this.batch<unknown>(
        batch.map((blockNumber) => ({
          method: "starknet_getBlockWithTxHashes",
          params: [{ block_number: blockNumber }],
        })),
      );
      headers.push(
        ...values.map((value, index) => parseBlock(value, batch[index] as number)),
      );
    }
    return headers;
  }

  async getEvents(filter: RpcEventFilter): Promise<RpcEventPage> {
    return parseEvents(await this.call("starknet_getEvents", [filter]));
  }

  async getClassHashAt(blockNumber: number, contractAddress: string): Promise<string> {
    return normalizeFelt(
      await this.call("starknet_getClassHashAt", [
        { block_number: blockNumber },
        contractAddress,
      ]),
      "class hash",
    );
  }

  async getClass(classHash: string, blockNumber: number): Promise<unknown> {
    return this.call("starknet_getClass", [{ block_number: blockNumber }, classHash]);
  }
}
