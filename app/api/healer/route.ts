import { NextRequest, NextResponse } from "next/server";
import { getSelfHealing } from "@/lib/mission/healer";
export async function GET() {
  const h = getSelfHealing();
  return NextResponse.json(h.monitor.check());
}
export async function POST(req: NextRequest) {
  const { command } = await req.json() as { command: string };
  if (!command) return NextResponse.json({ error: "command required" }, { status: 400 });
  const result = await getSelfHealing().execute(command);
  return NextResponse.json({ success: result.success, exitCode: result.exitCode, stdout: result.stdout.substring(0, 500), stderr: result.stderr.substring(0, 500), diagnosis: getSelfHealing().analyzeFailure(result) });
}
