import { NextRequest, NextResponse } from "next/server";
import { MissionController, GoalValidator, ProgressScorer, MissionCritic } from "@/lib/mission/core";

export async function POST(req: NextRequest) {
  const { name, description, goals } = await req.json() as { name: string; description: string; goals: string[] };
  if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });
  const mc = MissionController.create(name || description.substring(0, 60), description, goals || []);
  mc.start();
  return NextResponse.json({ id: mc.getId(), status: mc.getStatus() });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const mc = new MissionController(id, "", "", []);
    const goals = mc.getGoals();
    const scorer = new ProgressScorer();
    const progress = scorer.calculate(id);
    return NextResponse.json({ id, status: mc.getStatus(), progress: mc.getProgress(), goals, scorer: progress });
  }
  const all = req.nextUrl.searchParams.get("all");
  return NextResponse.json({ status: "ready", version: "v3" });
}
