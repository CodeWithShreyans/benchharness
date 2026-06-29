import { NextResponse } from "next/server";
import { getRun, listCellsForRun, listEventsForRun } from "@/lib/db/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const [run, cells, events] = await Promise.all([
    getRun(runId),
    listCellsForRun(runId),
    listEventsForRun(runId),
  ]);

  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  const publicCells = cells.map(
    ({ modelConfig: _modelConfig, ...cell }) => cell,
  );

  return NextResponse.json({ run, cells: publicCells, events });
}
