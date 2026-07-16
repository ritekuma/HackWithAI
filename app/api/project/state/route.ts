// GET /api/project/state — full project state
// POST /api/project/state — update project state
import { NextRequest, NextResponse } from "next/server";
import { getProjectState, getRecoveryInfo, getProjectContext } from "@/lib/memory/project-memory";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") || "full";

  if (format === "recovery") {
    return NextResponse.json(getRecoveryInfo());
  }
  if (format === "context") {
    return NextResponse.json({ context: getProjectContext() });
  }
  return NextResponse.json(getProjectState());
}
