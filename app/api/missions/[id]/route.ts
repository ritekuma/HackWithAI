// ── Mission by ID ──
// GET    /api/missions/[id]  → mission detail
// POST   /api/missions/[id]  → control (pause/resume/cancel/retry)

import { NextRequest, NextResponse } from "next/server";
import { getMissionEngine } from "@/lib/missions";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const engine = getMissionEngine();
  const mission = engine.get(id);
  if (!mission) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(mission);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = await request.json() as { action?: string };
  const engine = getMissionEngine();

  try {
    switch (action) {
      case "pause":
        engine.pause(id);
        return NextResponse.json({ status: "paused" });
      case "resume":
        engine.resume(id).catch(() => {});
        return NextResponse.json({ status: "resuming" });
      case "cancel":
        engine.cancel(id);
        return NextResponse.json({ status: "cancelled" });
      case "retry":
        engine.retry(id).catch(() => {});
        return NextResponse.json({ status: "retrying" });
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
