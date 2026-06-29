import { NextResponse } from "next/server";

export function authorizeInternalRequest(request: Request) {
  const secret = process.env.BENCH_START_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "BENCH_START_SECRET is not configured." },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : "";

  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}
