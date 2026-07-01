// ── Missions API ──
// GET  /api/missions         → list all
// POST /api/missions         → create + start

import { NextRequest, NextResponse } from "next/server";
import { getMissionEngine } from "@/lib/missions";

export async function GET(request: NextRequest) {
  const engine = getMissionEngine();
  const status = request.nextUrl.searchParams.get("status") as any;
  const missions = engine.list(status || undefined);
  return NextResponse.json({ missions, count: missions.length });
}

export async function POST(request: NextRequest) {
  const { title, objective, priority, owner } = await request.json() as {
    title?: string; objective?: string; priority?: string; owner?: string;
  };
  if (!title || !objective) {
    return NextResponse.json({ error: "title and objective required" }, { status: 400 });
  }
  const engine = getMissionEngine();
  const mission = engine.create(title, objective, (priority as any) || "medium", owner);
  engine.start(mission.id).catch(() => {});
  return NextResponse.json(mission, { status: 201 });
}
