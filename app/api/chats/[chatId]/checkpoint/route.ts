// POST /api/chats/[chatId]/checkpoint — save resume checkpoint
import { NextRequest, NextResponse } from "next/server";
import { saveResumeCheckpoint } from "@/lib/chat-db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params;
  try {
    const body = await req.json();
    saveResumeCheckpoint({
      chatId,
      goal: body.goal || "",
      plannerState: body.plannerState || {},
      executionJournal: body.executionJournal || [],
      toolOutputs: body.toolOutputs || {},
      scratchpad: body.scratchpad || "",
      workingMemory: body.workingMemory || [],
      resumeProtocol: body.resumeProtocol || "",
      messagesJson: body.messagesJson || [],
      updatedAt: Date.now(),
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params;
  const cp = await import("@/lib/chat-db").then(m => m.getResumeCheckpoint(chatId));
  if (!cp) return NextResponse.json(null, { status: 404 });
  return NextResponse.json(cp);
}
