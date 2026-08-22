import { createHash } from "node:crypto";
import type { PublicSnapshot, SnapshotHash } from "./types.js";

function stableValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, stableValue(record[key])]),
    );
  }
  return value;
}

function observationOrder(
  left: { blockNumber: number; eventIndex: number; eventId: string },
  right: { blockNumber: number; eventIndex: number; eventId: string },
): number {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber - right.blockNumber;
  if (left.eventIndex !== right.eventIndex) return left.eventIndex - right.eventIndex;
  return left.eventId.localeCompare(right.eventId);
}

export function canonicalSnapshot(snapshot: PublicSnapshot): PublicSnapshot {
  return {
    ...snapshot,
    queriedSelectors: [...snapshot.queriedSelectors].sort(),
    blockReferences: [...snapshot.blockReferences].sort(
      (left, right) => left.blockNumber - right.blockNumber,
    ),
    depositObservations: [...snapshot.depositObservations].sort(observationOrder),
    ...(snapshot.withdrawalObservations === undefined
      ? {}
      : {
          withdrawalObservations: [...snapshot.withdrawalObservations].sort(
            observationOrder,
          ),
        }),
    viewingKeyRegistrationObservations: [
      ...snapshot.viewingKeyRegistrationObservations,
    ].sort(observationOrder),
  };
}

export function canonicalSnapshotJson(snapshot: PublicSnapshot): string {
  return JSON.stringify(stableValue(canonicalSnapshot(snapshot)));
}

export function hashPublicSnapshot(snapshot: PublicSnapshot): SnapshotHash {
  return `0x${createHash("sha256").update(canonicalSnapshotJson(snapshot)).digest("hex")}`;
}
