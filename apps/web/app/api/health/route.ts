import { DataLayerError } from "@cutout/indexer/errors";
import {
  buildOperationalHealthReport,
  unavailableOperationalHealthReport,
} from "@cutout/operations/health";
import { processOperationalMetrics } from "@cutout/operations/metrics";
import { openHealthRuntime, runtimeNow } from "@web/lib/server-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const metrics = processOperationalMetrics();
  let runtimeState: Awaited<ReturnType<typeof openHealthRuntime>> | null = null;
  try {
    runtimeState = await openHealthRuntime();
    const report = buildOperationalHealthReport({
      store: runtimeState.store,
      config: runtimeState.config,
      abi: runtimeState.abi,
      now: runtimeNow,
      apiMetrics: metrics.snapshot(),
    });
    return Response.json(report, {
      status: report.ready ? 200 : 503,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof DataLayerError ? error.code : "SNAPSHOT_UNAVAILABLE";
    return Response.json(unavailableOperationalHealthReport(runtimeNow(), code, metrics.snapshot()), {
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
