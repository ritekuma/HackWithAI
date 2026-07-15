// POST /api/runtime/jobs — submit a job
// GET  /api/runtime/jobs?id=xxx — get job status
// DELETE /api/runtime/jobs?id=xxx — cancel a job
import { NextRequest, NextResponse } from "next/server";
import { getExecutionManager } from "@/lib/runtime/engine";

export async function POST(req: NextRequest) {
  const { description } = await req.json() as { description?: string };
  if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });
  const { jobId } = await getExecutionManager().submit(description);
  return NextResponse.json({ jobId, status: "QUEUED" });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "?id= required" }, { status: 400 });

  const status = getExecutionManager().status(id);
  return NextResponse.json(status);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "?id= required" }, { status: 400 });
  return NextResponse.json(getExecutionManager().cancel(id));
}
