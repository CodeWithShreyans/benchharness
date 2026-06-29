import { NextResponse } from "next/server";
import { authorizeInternalRequest } from "@/lib/api/auth";
import { benchmarkEventSchema } from "@/lib/api/validation";
import { addBenchmarkEvent } from "@/lib/db/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = authorizeInternalRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const json = await request.json().catch(() => null);
  const parsed = benchmarkEventSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid benchmark event.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const event = await addBenchmarkEvent(parsed.data);
  return NextResponse.json({ event }, { status: 201 });
}
