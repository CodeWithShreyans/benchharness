import { NextResponse } from "next/server";
import { benchmarkSuites } from "@/lib/benchmarks/registry";
import { getLeaderboard, listRuns } from "@/lib/db/repository";
import { harnessDescriptors } from "@/lib/harnesses/adapters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const [leaderboard, runs] = await Promise.all([getLeaderboard(), listRuns()]);

  return NextResponse.json({
    leaderboard,
    runs,
    suites: benchmarkSuites,
    harnesses: harnessDescriptors,
  });
}
