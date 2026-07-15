import { NextRequest, NextResponse } from "next/server";
import { runAutonomousWorkflow } from "@/lib/mission/workflow";
export async function POST(req: NextRequest) {
  const { description } = await req.json() as { description: string };
  if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });
  const result = await runAutonomousWorkflow(description);
  return NextResponse.json(result);
}
