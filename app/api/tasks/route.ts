// GET /api/tasks?chatId=xxx — list tasks for a chat
import { NextRequest, NextResponse } from "next/server";
import { getRunningTasksForChat } from "@/lib/api/agent-task-runner";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const chatId = url.searchParams.get("chatId");
  if (!chatId) return NextResponse.json({ tasks: [] });
  const tasks = getRunningTasksForChat(chatId);
  return NextResponse.json({ tasks });
}
