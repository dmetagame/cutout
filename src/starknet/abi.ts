import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { selector } from "starknet";
import { SpikeError } from "./errors.js";
import { normalizeAddress, normalizeFelt } from "./felt.js";

export interface AbiMemberFixture {
  readonly name: string;
  readonly type: string;
  readonly kind?: "key" | "data";
}

export interface AbiStructFixture {
  readonly type: "struct";
  readonly name: string;
  readonly members: readonly AbiMemberFixture[];
}

export interface AbiEventFixture {
  readonly type: "event";
  readonly name: string;
  readonly kind: "struct";
  readonly members: readonly AbiMemberFixture[];
}

export interface PoolAbiFixture {
  readonly fixtureVersion: string;
  readonly provenance: {
    readonly chainId: string;
    readonly poolAddress: string;
    readonly classHash: string;
    readonly retrievedAtBlock: number;
    readonly retrievedOn: string;
    readonly rpcMethods: readonly string[];
    readonly review: string;
  };
  readonly types: readonly AbiStructFixture[];
  readonly events: readonly AbiEventFixture[];
}

export interface ReviewedEventSchema {
  readonly fullName: string;
  readonly leafName: "Deposit" | "ViewingKeySet";
  readonly selector: string;
  readonly keyFeltCount: number;
  readonly dataFeltCount: number;
}

export interface ReviewedPoolAbi {
  readonly fixtureVersion: string;
  readonly chainId: string;
  readonly poolAddress: string;
  readonly classHash: string;
  readonly deposit: ReviewedEventSchema;
  readonly viewingKeySet: ReviewedEventSchema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SpikeError("POOL_ABI_INVALID", `${field} must be a non-empty string.`);
  }
  return value;
}

function parseMember(value: unknown, eventMember: boolean): AbiMemberFixture {
  if (!isRecord(value)) {
    throw new SpikeError("POOL_ABI_INVALID", "ABI member must be an object.");
  }
  const name = requireString(value.name, "ABI member name");
  const type = requireString(value.type, "ABI member type");
  if (!eventMember) return { name, type };
  if (value.kind !== "key" && value.kind !== "data") {
    throw new SpikeError("POOL_ABI_INVALID", `${name} must declare key or data kind.`);
  }
  return { name, type, kind: value.kind };
}

function parseStruct(value: unknown): AbiStructFixture {
  if (!isRecord(value) || value.type !== "struct" || !Array.isArray(value.members)) {
    throw new SpikeError("POOL_ABI_INVALID", "ABI struct fixture is invalid.");
  }
  return {
    type: "struct",
    name: requireString(value.name, "ABI struct name"),
    members: value.members.map((member) => parseMember(member, false)),
  };
}

function parseEvent(value: unknown): AbiEventFixture {
  if (
    !isRecord(value) ||
    value.type !== "event" ||
    value.kind !== "struct" ||
    !Array.isArray(value.members)
  ) {
    throw new SpikeError("POOL_ABI_INVALID", "ABI event fixture is invalid.");
  }
  return {
    type: "event",
    kind: "struct",
    name: requireString(value.name, "ABI event name"),
    members: value.members.map((member) => parseMember(member, true)),
  };
}

export function parsePoolAbiFixture(value: unknown): PoolAbiFixture {
  if (!isRecord(value) || !isRecord(value.provenance)) {
    throw new SpikeError("POOL_ABI_INVALID", "Pool ABI fixture is invalid.");
  }
  if (!Array.isArray(value.types) || !Array.isArray(value.events)) {
    throw new SpikeError("POOL_ABI_INVALID", "Pool ABI fixture lacks types or events.");
  }
  const provenance = value.provenance;
  const retrievedAtBlock = provenance.retrievedAtBlock;
  if (!Number.isSafeInteger(retrievedAtBlock) || (retrievedAtBlock as number) < 0) {
    throw new SpikeError("POOL_ABI_INVALID", "ABI provenance block is invalid.");
  }
  if (!Array.isArray(provenance.rpcMethods)) {
    throw new SpikeError("POOL_ABI_INVALID", "ABI provenance methods are invalid.");
  }
  return {
    fixtureVersion: requireString(value.fixtureVersion, "fixture version"),
    provenance: {
      chainId: normalizeFelt(provenance.chainId, "ABI chain id"),
      poolAddress: normalizeAddress(provenance.poolAddress, "ABI pool address"),
      classHash: normalizeFelt(provenance.classHash, "ABI class hash"),
      retrievedAtBlock: retrievedAtBlock as number,
      retrievedOn: requireString(provenance.retrievedOn, "ABI retrieval date"),
      rpcMethods: provenance.rpcMethods.map((method) =>
        requireString(method, "ABI provenance method"),
      ),
      review: requireString(provenance.review, "ABI review"),
    },
    types: value.types.map(parseStruct),
    events: value.events.map(parseEvent),
  };
}

export async function loadPoolAbiFixture(
  fixturePath = resolve(process.cwd(), "fixtures/pool-abi.json"),
): Promise<PoolAbiFixture> {
  let text: string;
  try {
    text = await readFile(fixturePath, "utf8");
  } catch (error) {
    throw new SpikeError(
      "POOL_ABI_INVALID",
      `Unable to read pool ABI fixture: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return parsePoolAbiFixture(JSON.parse(text));
  } catch (error) {
    if (error instanceof SpikeError) throw error;
    throw new SpikeError("POOL_ABI_INVALID", "Pool ABI fixture is not valid JSON.");
  }
}

function feltWidth(
  typeName: string,
  structs: ReadonlyMap<string, AbiStructFixture>,
  trail: ReadonlySet<string> = new Set(),
): number {
  if (
    typeName === "core::felt252" ||
    typeName === "core::starknet::contract_address::ContractAddress" ||
    typeName === "core::integer::u128"
  ) {
    return 1;
  }
  const struct = structs.get(typeName);
  if (struct === undefined || trail.has(typeName)) {
    throw new SpikeError("POOL_ABI_INVALID", `Unsupported ABI type ${typeName}.`);
  }
  const nextTrail = new Set(trail);
  nextTrail.add(typeName);
  return struct.members.reduce(
    (total, member) => total + feltWidth(member.type, structs, nextTrail),
    0,
  );
}

function schemaFor(
  event: AbiEventFixture,
  structs: ReadonlyMap<string, AbiStructFixture>,
): ReviewedEventSchema {
  const leafName = event.name.split("::").at(-1);
  if (leafName !== "Deposit" && leafName !== "ViewingKeySet") {
    throw new SpikeError("POOL_ABI_INVALID", `Unsupported reviewed event ${event.name}.`);
  }
  const keyFeltCount =
    1 +
    event.members
      .filter((member) => member.kind === "key")
      .reduce((total, member) => total + feltWidth(member.type, structs), 0);
  const dataFeltCount = event.members
    .filter((member) => member.kind === "data")
    .reduce((total, member) => total + feltWidth(member.type, structs), 0);
  return {
    fullName: event.name,
    leafName,
    selector: normalizeFelt(selector.getSelectorFromName(leafName), `${leafName} selector`),
    keyFeltCount,
    dataFeltCount,
  };
}

function assertExpectedMembers(event: AbiEventFixture): void {
  const expected =
    event.name.endsWith("::Deposit")
      ? [
          ["user_addr", "core::starknet::contract_address::ContractAddress", "key"],
          ["token", "core::starknet::contract_address::ContractAddress", "key"],
          ["amount", "core::integer::u128", "data"],
        ]
      : [
          ["user_addr", "core::starknet::contract_address::ContractAddress", "key"],
          ["public_key", "core::felt252", "key"],
          ["enc_private_key", "privacy::objects::EncPrivateKey", "data"],
        ];
  const actual = event.members.map((member) => [member.name, member.type, member.kind]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new SpikeError("POOL_ABI_INVALID", `${event.name} does not match the reviewed schema.`);
  }
}

export function reviewPoolAbi(fixture: PoolAbiFixture): ReviewedPoolAbi {
  const structs = new Map(fixture.types.map((type) => [type.name, type]));
  const depositEvent = fixture.events.find((event) => event.name.endsWith("::Deposit"));
  const viewingEvent = fixture.events.find((event) =>
    event.name.endsWith("::ViewingKeySet"),
  );
  if (depositEvent === undefined || viewingEvent === undefined || fixture.events.length !== 2) {
    throw new SpikeError("POOL_ABI_INVALID", "The reviewed ABI must contain exactly two events.");
  }
  assertExpectedMembers(depositEvent);
  assertExpectedMembers(viewingEvent);
  const deposit = schemaFor(depositEvent, structs);
  const viewingKeySet = schemaFor(viewingEvent, structs);
  if (deposit.keyFeltCount !== 3 || deposit.dataFeltCount !== 1) {
    throw new SpikeError("POOL_ABI_INVALID", "Deposit event width is invalid.");
  }
  if (viewingKeySet.keyFeltCount !== 3 || viewingKeySet.dataFeltCount !== 3) {
    throw new SpikeError("POOL_ABI_INVALID", "ViewingKeySet event width is invalid.");
  }
  return {
    fixtureVersion: fixture.fixtureVersion,
    chainId: fixture.provenance.chainId,
    poolAddress: fixture.provenance.poolAddress,
    classHash: fixture.provenance.classHash,
    deposit,
    viewingKeySet,
  };
}

function liveAbiEntries(value: unknown): readonly unknown[] {
  if (!isRecord(value)) {
    throw new SpikeError("POOL_ABI_MISMATCH", "Live class response is invalid.");
  }
  const abiValue = value.abi;
  if (Array.isArray(abiValue)) return abiValue;
  if (typeof abiValue === "string") {
    try {
      const parsed = JSON.parse(abiValue);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Handled below.
    }
  }
  throw new SpikeError("POOL_ABI_MISMATCH", "Live class ABI is unavailable.");
}

function comparableEntry(value: unknown, eventMember: boolean): unknown {
  if (!isRecord(value) || !Array.isArray(value.members)) return undefined;
  return {
    type: value.type,
    name: value.name,
    ...(eventMember ? { kind: value.kind } : {}),
    members: value.members.map((member) => {
      if (!isRecord(member)) return undefined;
      return {
        name: member.name,
        type: member.type,
        ...(eventMember ? { kind: member.kind } : {}),
      };
    }),
  };
}

export function assertLiveAbiMatchesFixture(
  fixture: PoolAbiFixture,
  liveClass: unknown,
): void {
  const entries = liveAbiEntries(liveClass);
  const expected: readonly (AbiStructFixture | AbiEventFixture)[] = [
    ...fixture.types,
    ...fixture.events,
  ];
  for (const entry of expected) {
    const live = entries.find(
      (candidate) => isRecord(candidate) && candidate.type === entry.type && candidate.name === entry.name,
    );
    if (
      live === undefined ||
      JSON.stringify(comparableEntry(live, entry.type === "event")) !==
        JSON.stringify(comparableEntry(entry, entry.type === "event"))
    ) {
      throw new SpikeError("POOL_ABI_MISMATCH", `Live ABI entry ${entry.name} changed.`);
    }
  }
}
