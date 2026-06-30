import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/api/auth";
import {
  addBenchmarkEvent,
  listRunsForDispatch,
  markStaleCellsInfraFailed,
} from "@/lib/db/repository";
import { dispatchQueuedCells } from "@/lib/sandbox/dispatch";
import { getVercelOidcToken } from "@/lib/sandbox/vercel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const staleMs = 60 * 60 * 1000;
type DispatchPumpItem = {
  runId: string;
  dispatch: Awaited<ReturnType<typeof dispatchQueuedCells>>;
};

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const staleCells = await markStaleCellsInfraFailed(staleMs);
  const runs = await listRunsForDispatch();
  const dispatches: DispatchPumpItem[] = [];

  for (const run of runs) {
    const dispatch = await dispatchQueuedCells(run.id, {
      oidcToken: getVercelOidcToken(request),
    });
    dispatches.push({ runId: run.id, dispatch });

    if (dispatch.launched > 0 || dispatch.skipped > 0) {
      await addBenchmarkEvent({
        runId: run.id,
        type: "dispatch.pump",
        message: "Dispatch pump checked queued benchmark cells.",
        payload: dispatch,
      });
    }
  }

  return NextResponse.json({
    staleCellsMarked: staleCells.length,
    runsChecked: runs.length,
    dispatches,
  });
}
