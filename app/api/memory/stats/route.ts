// ── Memory Stats API ──
// GET /api/memory/stats

import { NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";

export async function GET() {
  const memory = getMemory();
  const stats = memory.getStats();
  const experiences = memory.experience.getAll();
  const entities = memory.getEntities();
  const relationships = memory.getRelationships();

  return NextResponse.json({
    stats,
    experiences: {
      total: experiences.length,
      recent: experiences.slice(-5).map((e) => ({
        problem: e.problem.slice(0, 100),
        agent: e.agentId,
        success: e.success,
        time: e.executionTime,
      })),
    },
    knowledge_graph: {
      entities: entities.length,
      relationships: relationships.length,
    },
  });
}
