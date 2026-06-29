import { NextResponse } from "next/server";
import { authorizeInternalRequest } from "@/lib/api/auth";
import {
  startBenchmarkRunSchema,
  validateModelMatrix,
} from "@/lib/api/validation";
import { createBenchmarkRun } from "@/lib/db/repository";
import { dispatchQueuedCells } from "@/lib/sandbox/dispatch";
import { getVercelOidcToken } from "@/lib/sandbox/vercel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = authorizeInternalRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const json = await request.json().catch(() => null);
  const parsed = startBenchmarkRunSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid benchmark run request.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const modelErrors = validateModelMatrix(parsed.data);
  if (modelErrors.length > 0) {
    return NextResponse.json(
      { error: "Invalid benchmark model matrix.", details: modelErrors },
      { status: 400 },
    );
  }

  const { run, cells } = await createBenchmarkRun(parsed.data);
  const dispatch = await dispatchQueuedCells(run.id, {
    oidcToken: getVercelOidcToken(request),
  });

  return NextResponse.json(
    {
      run,
      cellsCreated: cells.length,
      dispatch,
    },
    { status: 202 },
  );
}
