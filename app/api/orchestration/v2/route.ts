// ── Orchestration V2: Real Multi-Agent Execution ──
// POST /api/orchestration/v2

import { NextRequest, NextResponse } from "next/server";
import { executeOrchestration } from "@/lib/orchestration/real-orchestrator";

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const body = await req.json();
    const { description } = body as { description?: string };

    if (!description) {
      return NextResponse.json(
        { error: "Required: description" },
        { status: 400 },
      );
    }

    const result = await executeOrchestration(description);

    return NextResponse.json({
      ...result,
      apiDurationMs: Date.now() - t0,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Orchestration failed",
        durationMs: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ready",
    agents: ["planner", "researcher", "architect", "coder", "tester", "security", "reviewer", "critic", "consensus"],
    version: "v2 (real LLM-driven)",
  });
}
