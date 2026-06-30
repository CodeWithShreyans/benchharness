import { NextResponse } from "next/server";
import { authorizeInternalRequest } from "@/lib/api/auth";
import { completeCellSchema } from "@/lib/api/validation";
import { addBenchmarkEvent, completeCell } from "@/lib/db/repository";
import { dispatchQueuedCells } from "@/lib/sandbox/dispatch";
import { getVercelOidcToken } from "@/lib/sandbox/vercel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cellId: string }> },
) {
  const unauthorized = authorizeInternalRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { cellId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = completeCellSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid cell completion payload.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const cell = await completeCell(cellId, parsed.data);
  if (!cell) {
    return NextResponse.json({ error: "Cell not found." }, { status: 404 });
  }

  await addBenchmarkEvent({
    runId: cell.runId,
    cellId: cell.id,
    type: `cell.${parsed.data.status}`,
    message:
      parsed.data.status === "completed"
        ? "Benchmark cell completed."
        : (parsed.data.error ?? "Benchmark cell failed."),
    payload: {
      score: parsed.data.score ?? null,
      passed: parsed.data.passed ?? null,
    },
  });

  const dispatch = await dispatchQueuedCells(cell.runId, {
    oidcToken: getVercelOidcToken(request),
  });
  return NextResponse.json({ cell, dispatch });
}
