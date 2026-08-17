import type { Page } from "@playwright/test";

export const HARNESS_ACCOUNT =
  "0x5854e275d709627eb88a95519326c528f8c5dc402d350d29e72dbcaf48b434f";
export const MAINNET_CHAIN_ID = "0x534e5f4d41494e";
export const POOL_ADDRESS =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

export interface WalletHarnessOptions {
  readonly chainId?: string;
  readonly apiVersions?: readonly string[];
  readonly simulationFailure?: string;
}

export interface WalletHarnessState {
  readonly connectCalls: number;
  readonly prepareCalls: number;
  readonly invokeCalls: number;
  readonly requests: readonly {
    readonly type: string;
    readonly params?: unknown;
  }[];
}

export async function installWalletHarness(
  page: Page,
  options: WalletHarnessOptions = {},
): Promise<void> {
  await page.addInitScript((input) => {
    const state = {
      connectCalls: 0,
      prepareCalls: 0,
      invokeCalls: 0,
      requests: [] as Array<{ type: string; params?: unknown }>,
    };
    const chainId = input.chainId;
    const account = {
      address: input.account,
      publicKey: new Uint8Array(),
      chains: [`starknet:${chainId}`],
      features: [
        "standard:connect",
        "standard:disconnect",
        "standard:events",
        "starknet:walletApi",
      ],
    };
    const wallet = {
      version: "1.0.0",
      name: "Cutout E2E Wallet",
      icon: "data:image/png;base64,AA==",
      chains: [`starknet:${chainId}`],
      accounts: [] as typeof account[],
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => {
            state.connectCalls += 1;
            wallet.accounts = [account];
            return { accounts: [account] };
          },
        },
        "standard:disconnect": {
          version: "1.0.0",
          disconnect: async () => {
            wallet.accounts = [];
          },
        },
        "standard:events": {
          version: "1.0.0",
          on: () => () => undefined,
        },
        "starknet:walletApi": {
          version: "1.0.0",
          walletVersion: "e2e-1.0.0",
          id: "cutout-e2e-wallet",
          request: async (request: { type: string; params?: unknown }) => {
            state.requests.push(request);
            if (request.type === "wallet_supportedWalletApi") {
              return input.apiVersions;
            }
            if (request.type === "wallet_requestChainId") {
              return chainId;
            }
            if (request.type === "wallet_strk20PrepareInvoke") {
              state.prepareCalls += 1;
              if (input.simulationFailure !== null) {
                throw new Error(input.simulationFailure);
              }
              const params = request.params as {
                readonly actions?: readonly unknown[];
                readonly simulate?: unknown;
              } | undefined;
              if (params?.simulate !== true || params.actions?.length !== 1) {
                throw new Error("Harness received an invalid simulation request.");
              }
              return {
                call: {
                  contract_address: input.poolAddress,
                  entry_point: "apply_actions",
                  calldata: Array.from({ length: 16 }, (_, index) => `0x${index.toString(16)}`),
                },
                proof: { data: "", output: [], proof_facts: [] },
              };
            }
            if (request.type === "wallet_strk20InvokeTransaction") {
              state.invokeCalls += 1;
              throw new Error("E2E broadcast is disabled at the pre-submission checkpoint.");
            }
            throw new Error(`Unexpected Wallet API request: ${request.type}`);
          },
        },
      },
    };

    const register = (api: { register(walletValue: unknown): () => void }) => {
      api.register(wallet);
    };
    window.addEventListener("wallet-standard:app-ready", (event) => {
      register((event as CustomEvent).detail);
    });
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", {
      detail: register,
    }));

    Object.defineProperty(window, "__cutoutWalletHarness", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: state,
    });
  }, {
    account: HARNESS_ACCOUNT,
    apiVersions: options.apiVersions ?? ["0.10.3"],
    chainId: options.chainId ?? MAINNET_CHAIN_ID,
    poolAddress: POOL_ADDRESS,
    simulationFailure: options.simulationFailure ?? null,
  });
}

export async function walletHarnessState(page: Page): Promise<WalletHarnessState> {
  return page.evaluate(() => {
    const state = (window as unknown as {
      __cutoutWalletHarness: WalletHarnessState;
    }).__cutoutWalletHarness;
    return structuredClone(state);
  });
}
