import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  PublicRpc,
  RpcBlockHeader,
  RpcEvent,
  RpcEventFilter,
  RpcEventPage,
} from "../../src/starknet/rpc.js";
import { SpikeError } from "../../src/starknet/errors.js";

interface FixtureEvent extends RpcEvent {
  readonly ordinal: number;
}

interface FixtureBranch {
  readonly blocks: readonly RpcBlockHeader[];
  readonly events: readonly FixtureEvent[];
}

export interface ReplayFixture {
  readonly fixtureVersion: string;
  readonly chainId: string;
  readonly poolAddress: string;
  readonly classHash: string;
  readonly depositSelector: string;
  readonly withdrawalSelector: string;
  readonly viewingKeySetSelector: string;
  readonly token: string;
  readonly account: string;
  readonly branches: {
    readonly canonical: FixtureBranch;
    readonly reorg: FixtureBranch;
  };
}

export async function loadReplayFixture(): Promise<ReplayFixture> {
  return JSON.parse(
    await readFile(resolve(process.cwd(), "fixtures/indexer/replay.json"), "utf8"),
  ) as ReplayFixture;
}

export class ReplayRpc implements PublicRpc {
  readonly fixture: ReplayFixture;
  branchName: keyof ReplayFixture["branches"] = "canonical";
  headBlock: number;
  pageSize = 1_000;
  reverseEventOrder = false;
  unknownSelector = false;
  classHashOverride: string | undefined;
  omittedBlocks = new Set<number>();
  unavailable = false;
  continuationRequests = 0;
  headSequence: number[] = [];

  constructor(fixture: ReplayFixture, headBlock: number) {
    this.fixture = fixture;
    this.headBlock = headBlock;
  }

  private branch(): FixtureBranch {
    return this.fixture.branches[this.branchName];
  }

  private assertAvailable(): void {
    if (this.unavailable) throw new SpikeError("RPC_ERROR", "fixture RPC unavailable");
  }

  async getChainId(): Promise<string> {
    this.assertAvailable();
    return this.fixture.chainId;
  }

  async getBlockNumber(): Promise<number> {
    this.assertAvailable();
    return this.headSequence.shift() ?? this.headBlock;
  }

  async getBlock(blockNumber: number): Promise<RpcBlockHeader> {
    this.assertAvailable();
    if (this.omittedBlocks.has(blockNumber)) throw new Error(`missing fixture block ${blockNumber}`);
    const block = this.branch().blocks.find((candidate) => candidate.blockNumber === blockNumber);
    if (block === undefined || blockNumber > this.headBlock) {
      throw new Error(`unknown fixture block ${blockNumber}`);
    }
    return structuredClone(block);
  }

  async getBlocks(blockNumbers: readonly number[]): Promise<readonly RpcBlockHeader[]> {
    const headers: RpcBlockHeader[] = [];
    for (const blockNumber of [...new Set(blockNumbers)]) {
      if (this.omittedBlocks.has(blockNumber)) continue;
      headers.push(await this.getBlock(blockNumber));
    }
    return headers;
  }

  async getEvents(filter: RpcEventFilter): Promise<RpcEventPage> {
    this.assertAvailable();
    const acceptedSelectors = new Set(filter.keys[0] ?? []);
    let events = this.branch().events.filter(
      (event) =>
        event.block_number >= filter.from_block.block_number &&
        event.block_number <= filter.to_block.block_number &&
        event.block_number <= this.headBlock &&
        event.from_address === filter.address &&
        acceptedSelectors.has(event.keys[0] ?? ""),
    );
    if (this.unknownSelector && events.length > 0) {
      events = [{ ...events[0] as FixtureEvent, keys: ["0xdead", ...(events[0]?.keys.slice(1) ?? [])] }];
    }
    events = [...events].sort((left, right) => left.ordinal - right.ordinal);
    if (this.reverseEventOrder) events.reverse();
    const offset = filter.continuation_token === undefined
      ? 0
      : Number(filter.continuation_token.replace("offset:", ""));
    if (filter.continuation_token !== undefined) this.continuationRequests += 1;
    const page = events.slice(offset, offset + this.pageSize).map(({ ordinal: _ordinal, ...event }) => event);
    const next = offset + this.pageSize < events.length
      ? `offset:${offset + this.pageSize}`
      : undefined;
    return next === undefined ? { events: page } : { events: page, continuationToken: next };
  }

  async getClassHashAt(_blockNumber: number, _contractAddress: string): Promise<string> {
    this.assertAvailable();
    return this.classHashOverride ?? this.fixture.classHash;
  }

  async getClass(_classHash: string, _blockNumber: number): Promise<unknown> {
    this.assertAvailable();
    return { abi: [] };
  }
}
