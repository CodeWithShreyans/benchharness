import { NextResponse } from "next/server";
import { getBenchmarkSuite } from "@/lib/benchmarks/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ suiteId: string }> },
) {
  const { suiteId } = await params;
  const suite = getBenchmarkSuite(suiteId);

  if (!suite) {
    return NextResponse.json({ error: "Suite not found." }, { status: 404 });
  }

  return NextResponse.json({ suite });
}
