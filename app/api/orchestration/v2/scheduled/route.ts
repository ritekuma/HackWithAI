// ── Orchestration V2 Scheduled: Intelligent Model Scheduler ──
// POST /api/orchestration/v2/scheduled

import { NextRequest, NextResponse } from "next/server";
import { executeScheduled } from "@/lib/orchestration/real-orchestrator";

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const body = await req.json();
    const { description } = body as { description?: string };

    if (!description) {
      return NextResponse.json({ error: "Required: description" }, { status: 400 });
    }

    const result = await executeScheduled(description);

    return NextResponse.json({
      ...result,
      apiDurationMs: Date.now() - t0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed", durationMs: Date.now() - t0 },
      { status: 500 },
    );
  }
}
