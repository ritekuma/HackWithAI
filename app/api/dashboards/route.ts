import { NextRequest, NextResponse } from "next/server";
import { getExecutionDashboard, getWorkerDashboard, getCostDashboard } from "@/lib/observability/engine";

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") || "execution";

  switch (type) {
    case "execution": return NextResponse.json(getExecutionDashboard());
    case "workers": return NextResponse.json(getWorkerDashboard());
    case "cost": return NextResponse.json(getCostDashboard());
    default: return NextResponse.json({ error: "Unknown type", options: ["execution", "workers", "cost"] }, { status: 400 });
  }
}
