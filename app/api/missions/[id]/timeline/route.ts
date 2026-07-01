import { NextRequest, NextResponse } from "next/server";
import { getMissionEngine } from "@/lib/missions";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const engine = getMissionEngine();
  const timeline = engine.getTimeline(id);
  return NextResponse.json({ missionId: id, timeline, entries: timeline.length });
}
