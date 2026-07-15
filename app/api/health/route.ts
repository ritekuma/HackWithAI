import { NextRequest, NextResponse } from "next/server";
import { healthCheck } from "@/lib/observability/engine";

export async function GET(_req: NextRequest) {
  const health = await healthCheck();
  const allHealthy = Object.values(health).every(h => h.status === "healthy");
  return NextResponse.json({ status: allHealthy ? "healthy" : "degraded", components: health }, { status: allHealthy ? 200 : 503 });
}
