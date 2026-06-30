import { NextResponse } from "next/server";
import { authorizeInternalRequest } from "@/lib/api/auth";
import { dispatchQueuedCells } from "@/lib/sandbox/dispatch";
import { getVercelOidcToken } from "@/lib/sandbox/vercel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const unauthorized = authorizeInternalRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { runId } = await params;
  const dispatch = await dispatchQueuedCells(runId, {
    oidcToken: getVercelOidcToken(request),
  });

  return NextResponse.json({ runId, dispatch });
}
