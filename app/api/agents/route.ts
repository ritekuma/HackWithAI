import { NextRequest, NextResponse } from "next/server";
import { getAgentManager } from "@/lib/mission/agents";

export async function GET() {
  const mgr = getAgentManager();
  const agents = mgr.listAgents().map(a => ({
    id: a.id, name: a.name, role: a.role, profile: a.profile, workflow: a.workflow,
    metrics: mgr.getMetrics(a.id),
  }));
  return NextResponse.json({ agents });
}

export async function POST(req: NextRequest) {
  const { description, agent: requested } = await req.json() as { description: string; agent?: string };
  if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });
  const mgr = getAgentManager();
  const result = await mgr.run(description);
  return NextResponse.json(result);
}
