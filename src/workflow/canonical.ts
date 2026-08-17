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

export function canonicalWorkflowJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function bytesToHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

export async function workflowSha256(value: unknown): Promise<`0x${string}`> {
  const bytes = new TextEncoder().encode(canonicalWorkflowJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `0x${bytesToHex(new Uint8Array(digest))}`;
}
