import {
  RpcProvider,
  WalletAccountV6,
  walletV6,
} from "starknet";
import type { STRK20_CALL_AND_PROOF, STRK20_DEPOSIT_ACTION } from "starknet";
import { createStore } from "@starknet-io/get-starknet-discovery";
import {
  isStarknetWallet,
  type WalletWithStarknetFeatures,
} from "@starknet-io/get-starknet-wallet-standard/features";
import type { Wallet } from "@wallet-standard/base";
import type { StarknetSpikeConfig } from "./config.js";
import { SpikeError, spikeErrorCode } from "./errors.js";
import { normalizeAddress, normalizeFelt } from "./felt.js";

export const REQUIRED_WALLET_API_VERSION = "0.10.3";

export type WalletFailureCode =
  | "UNSUPPORTED_WALLET"
  | "UNSUPPORTED_WALLET_API"
  | "WALLET_NETWORK_MISMATCH"
  | "WALLET_NOT_CONNECTED"
  | "BROWSER_CONTEXT_UNAVAILABLE"
  | "WALLET_CONNECTION_FAILED"
  | "WALLET_SIMULATION_FAILED";

export interface WalletCapabilityFailure {
  readonly status: "UNAVAILABLE";
  readonly code: WalletFailureCode;
  readonly message: string;
}

export interface WalletCapabilityReady {
  readonly status: "READY";
  readonly walletName: string;
  readonly supportedApiVersions: readonly string[];
  readonly selectedApiVersion: string;
  readonly chainId: string;
  readonly accountAddress: string;
  readonly wallet: WalletWithStarknetFeatures;
  readonly account: WalletAccountV6Like;
}

export type WalletCapability = WalletCapabilityFailure | WalletCapabilityReady;

export interface WalletAccountV6Like {
  readonly address?: string;
  strk20PrepareInvoke(
    actions: STRK20_DEPOSIT_ACTION[],
    simulate: boolean,
  ): Promise<STRK20_CALL_AND_PROOF>;
}

export interface WalletAdapterDependencies {
  readonly supportedWalletApi: (
    wallet: WalletWithStarknetFeatures,
  ) => Promise<readonly string[]>;
  readonly requestChainId: (wallet: WalletWithStarknetFeatures) => Promise<string>;
  readonly connect: (
    config: StarknetSpikeConfig,
    wallet: WalletWithStarknetFeatures,
  ) => Promise<WalletAccountV6Like>;
}

const defaultDependencies: WalletAdapterDependencies = {
  supportedWalletApi: (wallet) =>
    walletV6.supportedWalletApi(wallet as never) as Promise<readonly string[]>,
  requestChainId: (wallet) =>
    walletV6.requestChainId(wallet as never) as Promise<string>,
  connect: async (config, wallet) =>
    WalletAccountV6.connect(
      new RpcProvider({ nodeUrl: config.rpcUrl }),
      wallet as never,
      undefined,
      undefined,
      false,
    ),
};

function versionParts(value: string): readonly number[] | undefined {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")];
}

function versionAtLeast(value: string, required: string): boolean {
  const actual = versionParts(value);
  const minimum = versionParts(required);
  if (actual === undefined || minimum === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    const actualPart = actual[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (actualPart !== minimumPart) return actualPart > minimumPart;
  }
  return true;
}

function unavailable(
  code: WalletFailureCode,
  message: string,
): WalletCapabilityFailure {
  return { status: "UNAVAILABLE", code, message };
}

export function selectSupportedApiVersion(
  versions: readonly string[],
): string | undefined {
  return [...versions]
    .filter((version) => versionAtLeast(version, REQUIRED_WALLET_API_VERSION))
    .sort((left, right) => {
      const leftParts = versionParts(left) ?? [0, 0, 0];
      const rightParts = versionParts(right) ?? [0, 0, 0];
      for (let index = 0; index < 3; index += 1) {
        const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
        if (difference !== 0) return difference;
      }
      return 0;
    })[0];
}

export async function inspectWalletCapability(
  wallet: WalletWithStarknetFeatures | Wallet,
  config: StarknetSpikeConfig,
  dependencies: WalletAdapterDependencies = defaultDependencies,
): Promise<WalletCapability> {
  if (!isStarknetWallet(wallet)) {
    return unavailable("UNSUPPORTED_WALLET", "Wallet does not expose the required Starknet Wallet Standard features.");
  }
  let versions: readonly string[];
  try {
    versions = await dependencies.supportedWalletApi(wallet);
  } catch (error) {
    return unavailable(
      "UNSUPPORTED_WALLET_API",
      `Wallet API capability request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const selectedApiVersion = selectSupportedApiVersion(versions);
  if (selectedApiVersion === undefined) {
    return unavailable(
      "UNSUPPORTED_WALLET_API",
      `Wallet must support Wallet API ${REQUIRED_WALLET_API_VERSION} or newer.`,
    );
  }

  let account: WalletAccountV6Like;
  try {
    account = await dependencies.connect(config, wallet);
  } catch (error) {
    return unavailable(
      "WALLET_CONNECTION_FAILED",
      `Wallet connection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof account.address !== "string" || account.address.length === 0) {
    return unavailable("WALLET_NOT_CONNECTED", "Wallet returned no connected account.");
  }
  let accountAddress: string;
  try {
    accountAddress = normalizeAddress(account.address, "wallet account");
  } catch {
    return unavailable("WALLET_NOT_CONNECTED", "Wallet returned an invalid account address.");
  }

  // Ready X requires standard:connect authorization before exposing chain ID.
  let chainId: string;
  try {
    chainId = normalizeFelt(await dependencies.requestChainId(wallet), "wallet chain id");
  } catch (error) {
    return unavailable(
      "WALLET_NETWORK_MISMATCH",
      `Wallet network could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (chainId !== config.chainId) {
    return unavailable(
      "WALLET_NETWORK_MISMATCH",
      `Wallet is connected to ${chainId}, expected ${config.chainId}.`,
    );
  }
  return {
    status: "READY",
    walletName: wallet.name,
    supportedApiVersions: [...versions],
    selectedApiVersion,
    chainId,
    accountAddress,
    wallet,
    account,
  };
}

export async function discoverWallets(): Promise<readonly WalletWithStarknetFeatures[]> {
  if (typeof window === "undefined") return [];
  const store = createStore();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return store.getWallets();
}

export async function discoverAndInspectWallet(
  config: StarknetSpikeConfig,
  walletName?: string,
  dependencies: WalletAdapterDependencies = defaultDependencies,
): Promise<WalletCapability> {
  if (typeof window === "undefined") {
    return unavailable(
      "BROWSER_CONTEXT_UNAVAILABLE",
      "Wallet discovery requires a browser Wallet Standard context.",
    );
  }
  const wallets = await discoverWallets();
  const wallet =
    (walletName === undefined
      ? wallets[0]
      : wallets.find((candidate) => candidate.name === walletName));
  if (wallet === undefined) {
    return unavailable("UNSUPPORTED_WALLET", "No supported Starknet wallet was discovered.");
  }
  return inspectWalletCapability(wallet, config, dependencies);
}

export interface WalletSimulationResult {
  readonly status: "SIMULATED";
  readonly simulateFlag: true;
  readonly contractAddress: string;
  readonly entryPoint: string;
  readonly calldataLength: number;
  readonly proofEmpty: true;
}

export async function prepareDepositSimulation(
  account: WalletAccountV6Like,
  action: STRK20_DEPOSIT_ACTION,
): Promise<WalletSimulationResult | WalletCapabilityFailure> {
  try {
    const prepared = await account.strk20PrepareInvoke([action], true);
    if (
      prepared === null ||
      typeof prepared !== "object" ||
      prepared.call === undefined ||
      prepared.proof === undefined ||
      typeof prepared.call.contract_address !== "string" ||
      typeof prepared.call.entry_point !== "string" ||
      !Array.isArray(prepared.call.calldata) ||
      prepared.proof.data !== "" ||
      prepared.proof.output.length !== 0 ||
      prepared.proof.proof_facts.length !== 0
    ) {
      return unavailable(
        "WALLET_SIMULATION_FAILED",
        "Wallet returned an invalid or non-simulation STRK20 preparation.",
      );
    }
    return {
      status: "SIMULATED",
      simulateFlag: true,
      contractAddress: normalizeAddress(prepared.call.contract_address, "prepared contract"),
      entryPoint: prepared.call.entry_point,
      calldataLength: prepared.call.calldata.length,
      proofEmpty: true,
    };
  } catch (error) {
    return unavailable(
      "WALLET_SIMULATION_FAILED",
      `Wallet simulation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function walletErrorCode(error: unknown): WalletFailureCode | "UNKNOWN" {
  const code = spikeErrorCode(error);
  return code === "UNKNOWN" ? "UNKNOWN" : code as WalletFailureCode;
}
