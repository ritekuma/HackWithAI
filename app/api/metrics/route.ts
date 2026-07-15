import { NextRequest, NextResponse } from "next/server";
import { metrics } from "@/lib/observability/engine";

export async function GET(_req: NextRequest) {
  const format = _req.nextUrl.searchParams.get("format") || "text";
  if (format === "json") {
    return NextResponse.json(metrics.snapshot());
  }
  return new NextResponse(metrics.prometheus(), {
    headers: { "Content-Type": "text/plain; version=0.0.4" },
  });
}
