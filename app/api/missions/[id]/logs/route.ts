import { NextRequest, NextResponse } from "next/server";
import { getMissionEngine } from "@/lib/missions";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const engine = getMissionEngine();
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");
  const logs = engine.getLogs(id, limit);
  return NextResponse.json({ missionId: id, logs, count: logs.length });
}
