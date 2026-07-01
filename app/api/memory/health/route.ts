// ── Memory Health API ──
// GET /api/memory/health

import { NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";

export async function GET() {
  const memory = getMemory();
  const stats = memory.getStats();

  return NextResponse.json({
    status: "healthy",
    redis: stats.redisKeys > 0 ? "connected" : "idle",
    experience_engine: stats.byType.experience > 0 ? "active" : "ready",
    knowledge_graph: stats.byType.knowledge > 0 ? "active" : "ready",
    stats,
  });
}
