import { CUTOUT_MODEL } from "../src/engine/constants.js";
import { loadPoolAbiFixture } from "../src/starknet/abi.js";
import {
  buildDepositAction,
  supportedTokenAddress,
} from "../src/starknet/actions.js";
import { mainnetConfig, tokenByAddress } from "../src/starknet/config.js";
import { SpikeError } from "../src/starknet/errors.js";
import { normalizeAddress } from "../src/starknet/felt.js";
import { ingestPublicSnapshot } from "../src/starknet/ingest.js";
import { FRESHNESS_POLICY, GUARD_POLICY } from "../src/starknet/policies.js";
import { runSpikePreflight } from "../src/starknet/preflight.js";
import { JsonRpcClient } from "../src/starknet/rpc.js";
import { hashPublicSnapshot } from "../src/starknet/snapshot.js";
import type { SpikeShieldIntent } from "../src/starknet/types.js";
import { discoverAndInspectWallet } from "../src/starknet/wallet.js";

const HISTORY_BOUNDARY_BUFFER_SECONDS = 10 * 60;

function parsePositiveBigInt(value: string | undefined, field: string): bigint | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) throw new Error("not positive");
    return parsed;
  } catch {
    throw new SpikeError("INVALID_AMOUNT", `${field} must be a positive base-unit integer.`);
  }
}

function parseOptionalBlock(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SpikeError("SOURCE_INCOMPLETE", "CUTOUT_SPIKE_SOURCE_FROM_BLOCK is invalid.");
  }
  return parsed;
}

function stringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item: unknown) => typeof item === "bigint" ? item.toString(10) : item,
    2,
  );
}

function sampleIntent(
  snapshot: Awaited<ReturnType<typeof ingestPublicSnapshot>>["snapshot"],
  config: ReturnType<typeof mainnetConfig>,
): SpikeShieldIntent {
  const requestedToken = process.env.CUTOUT_SPIKE_TOKEN;
  const configuredToken = requestedToken === undefined
    ? undefined
    : tokenByAddress(config, normalizeAddress(requestedToken, "sample token"));
  if (requestedToken !== undefined && configuredToken === undefined) {
    throw new SpikeError("UNSUPPORTED_TOKEN", "CUTOUT_SPIKE_TOKEN is not configured.");
  }
  const fallbackToken = supportedTokenAddress(config, "USDC");
  if (fallbackToken === undefined) {
    throw new SpikeError("UNSUPPORTED_TOKEN", "USDC is missing from mainnet configuration.");
  }
  const liveSample = [...snapshot.depositObservations]
    .reverse()
    .find((observation) =>
      configuredToken === undefined
        ? tokenByAddress(config, observation.token) !== undefined
        : observation.token === configuredToken.address,
    );
  const token = configuredToken?.address ?? liveSample?.token ?? fallbackToken;
  const amount =
    parsePositiveBigInt(process.env.CUTOUT_SPIKE_AMOUNT, "CUTOUT_SPIKE_AMOUNT") ??
    liveSample?.amount ??
    1_000_000n;
  const requestedMin = parsePositiveBigInt(
    process.env.CUTOUT_SPIKE_MIN_AMOUNT,
    "CUTOUT_SPIKE_MIN_AMOUNT",
  );
  const requestedMax = parsePositiveBigInt(
    process.env.CUTOUT_SPIKE_MAX_AMOUNT,
    "CUTOUT_SPIKE_MAX_AMOUNT",
  );
  const defaultMin = (amount * 9_800n) / 10_000n;
  const min = requestedMin ?? (defaultMin > 0n ? defaultMin : 1n);
  const max = requestedMax ?? (amount * 10_200n + 9_999n) / 10_000n;
  const account = normalizeAddress(
    process.env.CUTOUT_SPIKE_ACCOUNT ?? liveSample?.depositor ?? "0x1",
    "sample account",
  );
  const evaluationTimestamp = Math.floor(Date.now() / 1_000);
  return {
    action: "shield",
    chainId: config.chainId,
    account,
    token,
    amount,
    evaluationBlock: snapshot.observedBlock,
    evaluationTimestamp,
    flexibility: { mode: "flexible", min, max },
    deadline: evaluationTimestamp + 3_600,
  };
}

async function main(): Promise<void> {
  const config = mainnetConfig();
  const fixture = await loadPoolAbiFixture();
  const rpc = new JsonRpcClient(config.rpcUrl);
  const startedAt = Math.floor(Date.now() / 1_000);
  const requiredFromTimestamp =
    startedAt - CUTOUT_MODEL.observationSeconds - HISTORY_BOUNDARY_BUFFER_SECONDS;
  const sourceFromBlock = parseOptionalBlock(process.env.CUTOUT_SPIKE_SOURCE_FROM_BLOCK);

  console.log("CUTOUT Milestone 1: mainnet shield-preflight spike");
  console.log("RPC: configured public-data provider (URL redacted)");
  console.log(`Pool: ${config.poolAddress}`);
  console.log(`Model: ${CUTOUT_MODEL.version}`);
  console.log(`Policies: ${FRESHNESS_POLICY.version}, ${GUARD_POLICY.version}`);

  const { snapshot, abi, eventPages } = await ingestPublicSnapshot({
    rpc,
    config,
    fixture,
    requiredFromTimestamp,
    ...(sourceFromBlock === undefined ? {} : { sourceFromBlock }),
    onProgress: (message) => console.log(`[rpc] ${message}`),
  });
  const snapshotHash = hashPublicSnapshot(snapshot);
  const intent = sampleIntent(snapshot, config);
  const preflight = runSpikePreflight({ snapshot, intent, config, abi });
  const action = buildDepositAction(intent, config);
  const walletCapability = await discoverAndInspectWallet(config);

  console.log("\nFreshness metadata");
  console.log(stringify({
    observedBlock: snapshot.observedBlock,
    observedBlockHash: snapshot.observedBlockHash,
    observedTimestamp: snapshot.observedTimestamp,
    indexedThroughBlock: snapshot.indexedThroughBlock,
    indexedThroughHash: snapshot.indexedThroughHash,
    indexedThroughTimestamp: snapshot.indexedThroughTimestamp,
    rpcHeadBlock: snapshot.rpcHeadBlock,
    rpcHeadHash: snapshot.rpcHeadHash,
    rpcHeadTimestamp: snapshot.rpcHeadTimestamp,
    indexLagSeconds: snapshot.rpcHeadTimestamp - snapshot.indexedThroughTimestamp,
    sourceAgeSeconds: intent.evaluationTimestamp - snapshot.indexedThroughTimestamp,
    sourceFromBlock: snapshot.sourceFromBlock,
    sourceFromTimestamp: snapshot.sourceFromTimestamp,
    sourceComplete: snapshot.sourceComplete && snapshot.pagesComplete,
  }));
  console.log("\nDecoded public observations");
  console.log(stringify({
    eventPages,
    deposits: snapshot.depositObservations.length,
    viewingKeyRegistrations: snapshot.viewingKeyRegistrationObservations.length,
    depositExample: snapshot.depositObservations.at(-1) ?? null,
    viewingKeyRegistrationExample:
      snapshot.viewingKeyRegistrationObservations.at(-1) ?? null,
  }));
  console.log("\nSnapshot");
  console.log(stringify({ snapshotHash, engineVersion: snapshot.engineVersion }));
  console.log("\nPreflight");
  console.log(stringify(preflight));
  console.log("\nTyped STRK20 action");
  console.log(stringify(action));
  console.log("\nWallet capability");
  console.log(stringify(walletCapability));
  console.log("\nSimulation");
  console.log(stringify({
    status: "NOT_RUN",
    reason: "The Node CLI has no browser Wallet Standard context.",
  }));
  console.log("\nNO TRANSACTION WAS SUBMITTED.");
}

main().catch((error: unknown) => {
  const code = error instanceof SpikeError ? error.code : "UNKNOWN";
  console.error(stringify({ status: "FAILED_CLOSED", code, message: error instanceof Error ? error.message : String(error) }));
  console.error("NO TRANSACTION WAS SUBMITTED.");
  process.exitCode = 1;
});
