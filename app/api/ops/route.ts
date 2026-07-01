// ── Operations Center API ──
// GET /api/ops → full dashboard
// GET /api/ops?section=missions → filtered

import { NextRequest, NextResponse } from "next/server";
import { OpsCenter } from "@/lib/ops";

let _ops: OpsCenter;

function ops(): OpsCenter {
  if (!_ops) _ops = new OpsCenter();
  return _ops;
}

export async function GET(request: NextRequest) {
  const section = request.nextUrl.searchParams.get("section");
  const dashboard = await ops().getDashboard();

  if (section && section in dashboard) {
    return NextResponse.json({ [section]: (dashboard as any)[section] });
  }

  return NextResponse.json(dashboard);
}
