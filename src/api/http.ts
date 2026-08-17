import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { canonicalJson } from "./canonical.js";
import { PreflightService } from "./preflight.js";
import type { PreflightApiResponse } from "./types.js";

const MAX_BODY_BYTES = 64 * 1_024;

export interface ApiLogEntry {
  readonly event: "preflight";
  readonly status: PreflightApiResponse["status"];
  readonly snapshotHash: string | null;
  readonly decision?: string;
  readonly riskBand?: string;
  readonly errorCode?: string;
  readonly durationMs: number;
}

export type ApiLogger = (entry: ApiLogEntry) => void;

export interface ApiHealthResponse {
  readonly statusCode: number;
  readonly body: unknown;
}

export type ApiHealthHandler = () => ApiHealthResponse | Promise<ApiHealthResponse>;

export interface RoutedPreflightRequest {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly body: unknown;
}

export interface RoutedPreflightResponse {
  readonly statusCode: number;
  readonly body: unknown;
  readonly allow?: "POST";
  readonly preflightResult?: PreflightApiResponse;
}

function statusCode(response: PreflightApiResponse): number {
  if (response.status === "AVAILABLE") return 200;
  if (
    response.error.code === "INVALID_INTENT" ||
    response.error.code === "UNSUPPORTED_ACTION" ||
    response.error.code === "UNSUPPORTED_TOKEN" ||
    response.error.code === "UNKNOWN_POOL"
  ) {
    return 400;
  }
  if (
    response.error.code === "INDEX_CORRUPT" ||
    response.error.code === "INCONSISTENT_BLOCK_DATA" ||
    response.error.code === "MODEL_VERSION_MISMATCH" ||
    response.error.code === "POOL_SCHEMA_MISMATCH"
  ) {
    return 409;
  }
  return 503;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(canonicalJson(body));
}

export function routePreflightRequest(
  service: PreflightService,
  request: RoutedPreflightRequest,
): RoutedPreflightResponse {
  if (request.url !== "/api/preflight") {
    return { statusCode: 404, body: { error: "NOT_FOUND" } };
  }
  if (request.method !== "POST") {
    return {
      statusCode: 405,
      allow: "POST",
      body: { error: "METHOD_NOT_ALLOWED" },
    };
  }
  const result = service.preflight(request.body);
  return {
    statusCode: statusCode(result),
    body: result,
    preflightResult: result,
  };
}

export function preflightLogEntry(
  result: PreflightApiResponse,
  durationMs: number,
): ApiLogEntry {
  return {
    event: "preflight",
    status: result.status,
    snapshotHash: result.snapshotHash,
    ...(result.status === "AVAILABLE"
      ? { decision: result.decision, riskBand: result.riskBand }
      : { errorCode: result.error.code }),
    durationMs,
  };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error("EMPTY_BODY");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createPreflightHttpServer(
  service: PreflightService,
  logger: ApiLogger = () => {},
  health: ApiHealthHandler | undefined = undefined,
): Server {
  return createServer(async (request, response) => {
    if (request.url === "/api/health" && request.method === "GET" && health !== undefined) {
      try {
        const result = await health();
        sendJson(response, result.statusCode, result.body);
      } catch {
        sendJson(response, 503, { status: "UNAVAILABLE", errorCode: "SNAPSHOT_UNAVAILABLE" });
      }
      return;
    }
    const started = performance.now();
    let body: unknown;
    if (request.url === "/api/preflight" && request.method === "POST") {
      try {
        body = await readJson(request);
      } catch {
        body = null;
      }
    } else {
      body = null;
    }
    const routed = routePreflightRequest(service, {
      method: request.method,
      url: request.url,
      body,
    });
    if (routed.allow !== undefined) response.setHeader("allow", routed.allow);
    if (routed.preflightResult !== undefined) {
      logger(preflightLogEntry(
        routed.preflightResult,
        Math.round((performance.now() - started) * 1_000) / 1_000,
      ));
    }
    sendJson(response, routed.statusCode, routed.body);
  });
}
