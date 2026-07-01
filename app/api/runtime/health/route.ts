// ── Runtime Health API ──
// GET /api/runtime/health → returns runtime status

import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/ai-runtime/bootstrap";

export async function GET() {
  const runtime = getRuntime();
  const health = await runtime.health();
  return NextResponse.json(health);
}
