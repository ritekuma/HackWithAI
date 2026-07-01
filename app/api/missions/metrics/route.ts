import { NextResponse } from "next/server";
import { getMissionEngine } from "@/lib/missions";

export async function GET() {
  const engine = getMissionEngine();
  const metrics = engine.metrics();
  return NextResponse.json(metrics);
}
