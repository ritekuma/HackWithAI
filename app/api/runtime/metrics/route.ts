// GET /api/runtime/metrics
import { NextRequest, NextResponse } from "next/server";
import { getExecutionManager } from "@/lib/runtime/engine";

export async function GET(_req: NextRequest) {
  return NextResponse.json(getExecutionManager().getMetrics());
}
