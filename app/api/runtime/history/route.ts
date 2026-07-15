// GET /api/runtime/history
import { NextRequest, NextResponse } from "next/server";
import { getExecutionManager } from "@/lib/runtime/engine";

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20", 10);
  return NextResponse.json(getExecutionManager().getHistory(limit));
}
