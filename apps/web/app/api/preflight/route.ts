import { performance } from "node:perf_hooks";

import { preflightLogEntry, routePreflightRequest } from "@cutout/api/http";
import { PreflightService, unavailablePreflightResponse } from "@cutout/api/preflight";
import { CUTOUT_MODEL_V1_4 } from "@cutout/engine/constants";
import { DataLayerError } from "@cutout/indexer/errors";
import { processOperationalMetrics } from "@cutout/operations/metrics";
import { openPreflightRuntime, runtimeNow } from "@web/lib/server-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1_024;

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
  }
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const started = performance.now();
  const metrics = processOperationalMetrics();
  let runtimeState: Awaited<ReturnType<typeof openPreflightRuntime>> | null = null;
  try {
    runtimeState = await openPreflightRuntime();
    const service = new PreflightService(
      runtimeState.store,
      runtimeState.config,
      runtimeState.abi,
      { now: runtimeNow, modelVersion: CUTOUT_MODEL_V1_4.version },
    );
    const routed = routePreflightRequest(service, {
      method: "POST",
      url: "/api/preflight",
      body,
    });
    if (routed.preflightResult !== undefined) {
      const durationMs = Math.round((performance.now() - started) * 1_000) / 1_000;
      metrics.recordPreflight(durationMs, routed.preflightResult.status !== "AVAILABLE");
      console.log(JSON.stringify(preflightLogEntry(
        routed.preflightResult,
        durationMs,
      )));
    }
    return Response.json(routed.body, {
      status: routed.statusCode,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof DataLayerError ? error.code : "SNAPSHOT_UNAVAILABLE";
    const result = unavailablePreflightResponse(
      code,
      "Canonical public evidence is operationally unavailable.",
      CUTOUT_MODEL_V1_4.version,
    );
    const durationMs = Math.round((performance.now() - started) * 1_000) / 1_000;
    metrics.recordPreflight(durationMs, true);
    console.log(JSON.stringify(preflightLogEntry(result, durationMs)));
    return Response.json(result, {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } finally {
    runtimeState?.store.close();
  }
}
