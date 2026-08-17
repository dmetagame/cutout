import type { Address } from "../engine/types.js";
import type { ReviewedPoolAbi, ReviewedEventSchema } from "./abi.js";
import { SpikeError } from "./errors.js";
import {
  normalizeAddress,
  normalizeFelt,
  normalizeTransactionHash,
  parseU128,
} from "./felt.js";
import type { RpcBlockHeader, RpcEvent } from "./rpc.js";
import type {
  PublicDepositObservation,
  PublicRegistrationObservation,
} from "./types.js";

export type NormalizedPoolObservation =
  | { readonly kind: "deposit"; readonly observation: PublicDepositObservation }
  | {
      readonly kind: "viewing-key-registration";
      readonly observation: PublicRegistrationObservation;
    };

function schemaForSelector(
  eventSelector: string,
  abi: ReviewedPoolAbi,
): ReviewedEventSchema {
  if (eventSelector === abi.deposit.selector) return abi.deposit;
  if (eventSelector === abi.viewingKeySet.selector) return abi.viewingKeySet;
  throw new SpikeError(
    "UNKNOWN_EVENT_SELECTOR",
    `Event selector ${eventSelector} is not in the reviewed pool ABI.`,
  );
}

function eventId(raw: RpcEvent, eventIndex: number): string {
  return `${raw.block_number}:${normalizeTransactionHash(raw.transaction_hash)}:${eventIndex}`;
}

export function decodePoolEvent(
  raw: RpcEvent,
  eventIndex: number,
  block: RpcBlockHeader,
  poolAddress: Address,
  abi: ReviewedPoolAbi,
): NormalizedPoolObservation {
  if (raw.keys.length === 0) {
    throw new SpikeError("EVENT_SCHEMA_INVALID", "Pool event has no selector.");
  }
  if (raw.block_number !== block.blockNumber) {
    throw new SpikeError("BLOCK_HASH_INCONSISTENT", "Event block number does not match its header.");
  }
  const rawBlockHash = normalizeFelt(raw.block_hash, "event block hash");
  if (rawBlockHash !== block.blockHash) {
    throw new SpikeError("BLOCK_HASH_INCONSISTENT", "Event block hash does not match its header.");
  }
  if (normalizeAddress(raw.from_address, "event source") !== poolAddress) {
    throw new SpikeError("POOL_ADDRESS_MISMATCH", "Event was not emitted by the configured pool.");
  }

  const eventSelector = normalizeFelt(raw.keys[0], "event selector");
  const schema = schemaForSelector(eventSelector, abi);
  if (raw.keys.length !== schema.keyFeltCount || raw.data.length !== schema.dataFeltCount) {
    throw new SpikeError(
      "EVENT_SCHEMA_INVALID",
      `${schema.leafName} event does not match its reviewed ABI width.`,
    );
  }

  const transactionHash = normalizeTransactionHash(raw.transaction_hash);
  const identity = eventId(raw, eventIndex);
  if (schema.leafName === "Deposit") {
    const depositor = normalizeAddress(raw.keys[1], "deposit user_addr");
    const token = normalizeAddress(raw.keys[2], "deposit token");
    const amount = parseU128(raw.data[0], "deposit amount");
    return {
      kind: "deposit",
      observation: {
        blockNumber: block.blockNumber,
        blockHash: block.blockHash,
        timestamp: block.timestamp,
        transactionHash,
        eventIndex,
        eventId: identity,
        eventSelector,
        depositor,
        token,
        amount,
        normalizedFields: {
          depositor,
          token,
          amount: amount.toString(10),
        },
      },
    };
  }

  // Public key and encrypted-key payload fields are deliberately neither parsed nor retained.
  const account = normalizeAddress(raw.keys[1], "viewing-key user_addr");
  return {
    kind: "viewing-key-registration",
    observation: {
      blockNumber: block.blockNumber,
      blockHash: block.blockHash,
      timestamp: block.timestamp,
      transactionHash,
      eventIndex,
      eventId: identity,
      eventSelector,
      account,
      normalizedFields: { account },
    },
  };
}
