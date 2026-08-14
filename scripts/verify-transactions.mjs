#!/usr/bin/env node

const RPC_URL = process.env.RPC_URL ?? "https://rpc.starknet.lava.build";
const POOL_ADDRESS = normalizeFelt(
  process.env.POOL_ADDRESS ??
    "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
);

function normalizeFelt(value) {
  return BigInt(value).toString(16);
}

const hashes = process.argv.slice(2);
if (hashes.length === 0) {
  console.error("Usage: npm run verify:transactions -- 0xHASH [0xHASH ...]");
  process.exit(2);
}

async function receipt(transactionHash, id) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Cutout/0.1 transaction verifier",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "starknet_getTransactionReceipt",
      params: [transactionHash],
    }),
  });
  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error !== undefined) {
    throw new Error(payload.error.message ?? JSON.stringify(payload.error));
  }
  return payload.result;
}

let failed = false;
for (const [index, transactionHash] of hashes.entries()) {
  try {
    const result = await receipt(transactionHash, index + 1);
    const succeeded = result.execution_status === "SUCCEEDED";
    const poolEvents = (result.events ?? []).filter(
      (event) =>
        event.from_address !== undefined &&
        normalizeFelt(event.from_address) === POOL_ADDRESS,
    );
    const valid = succeeded && poolEvents.length > 0;
    failed ||= !valid;
    console.log(
      JSON.stringify(
        {
          transactionHash,
          valid,
          executionStatus: result.execution_status,
          finalityStatus: result.finality_status,
          poolEventCount: poolEvents.length,
          blockNumber: result.block_number,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    failed = true;
    console.error(
      JSON.stringify(
        {
          transactionHash,
          valid: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
  }
}

process.exitCode = failed ? 1 : 0;
