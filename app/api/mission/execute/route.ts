import { NextRequest, NextResponse } from "next/server";
import { executeMissionControlled } from "@/lib/mission/executor";

export async function POST(req: NextRequest) {
  const { description, model } = await req.json() as { description: string; model?: string };
  if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });
  const result = await executeMissionControlled(description, model);
  return NextResponse.json(result);
}
