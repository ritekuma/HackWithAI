import { NextRequest, NextResponse } from "next/server";
import { getLearningEngine } from "@/lib/mission/learning";

export async function GET() {
  return NextResponse.json(getLearningEngine().getStats());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { problem: string; rootCause: string; repair: string; verification: string; agent: string; workflow: string; success: boolean; repository?: string };
  const exp = getLearningEngine().learn({
    problem: body.problem || "", rootCause: body.rootCause || "", repair: body.repair || "",
    verification: body.verification || "", agent: body.agent || "builder",
    workflow: body.workflow || "general", repository: body.repository || process.cwd(),
    techStack: ["TypeScript", "Next.js"], success: body.success !== false, attempts: 1, durationMs: 0,
  });
  return NextResponse.json(exp || { error: "not learned" });
}
