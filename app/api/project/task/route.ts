// POST /api/project/task — create/update tasks
// POST /api/project/decision — record decisions
// POST /api/project/bug — record/fix bugs
import { NextRequest, NextResponse } from "next/server";
import {
  createTask, updateTaskStatus,
  recordDecision,
  recordBug, fixBug,
} from "@/lib/memory/project-memory";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "create_task":
        return NextResponse.json(createTask(body.title, body.description, body.priority, body.parentId));
      case "update_task":
        return NextResponse.json({ ok: updateTaskStatus(body.id, body.status) });
      case "decision":
        return NextResponse.json(recordDecision(body.title, body.context || "", body.decision));
      case "bug":
        return NextResponse.json(recordBug(body.title, body.description));
      case "fix_bug":
        return NextResponse.json({ ok: fixBug(body.id, body.fixDescription || "") });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
