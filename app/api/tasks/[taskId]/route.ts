// GET /api/tasks/[taskId] — task status and progress
// POST /api/tasks/[taskId] — update task (internal)
import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTaskStatus, getRunningTasksForChat } from "@/lib/api/agent-task-runner";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;

  // Support ?chatId= query param to find running tasks for a chat
  const url = new URL(_req.url);
  const chatId = url.searchParams.get("chatId");

  if (chatId) {
    const tasks = getRunningTasksForChat(chatId);
    return NextResponse.json({ tasks });
  }

  const task = getTask(taskId);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json(task);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  try {
    const body = await req.json();
    if (body.status) {
      updateTaskStatus(taskId, body.status, body.error || null);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
