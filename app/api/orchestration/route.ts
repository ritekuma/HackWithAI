// ── Orchestration API (DEPRECATED — use /api/orchestration/v2) ──
// This endpoint is retired. All requests route to the real V2 orchestrator.

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      error: "This endpoint is deprecated",
      message: "Use /api/orchestration/v2 for the real LLM-driven multi-agent orchestrator.",
      docs: "/api/orchestration/v2",
    },
    { status: 410 },
  );
}

export async function POST(request: NextRequest) {
  return NextResponse.json(
    {
      error: "This endpoint is deprecated",
      message: "POST to /api/orchestration/v2 instead. This endpoint no longer executes tasks.",
      migration: "/api/orchestration/v2",
    },
    { status: 410 },
  );
}
