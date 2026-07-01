// ── Memory Search API ──
// GET /api/memory/search?q=query

import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/lib/memory";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "";
  if (!query) {
    return NextResponse.json({ error: "Query parameter 'q' required" }, { status: 400 });
  }

  const memory = getMemory();
  const results = await memory.search(query);
  const context = {
    query,
    results: results.map((r) => ({
      score: r.score,
      source: r.source,
      content: r.entry.content.slice(0, 300),
      type: r.entry.type,
      agentId: r.entry.sourceAgentId,
      tags: r.entry.tags,
    })),
    totalResults: results.length,
  };

  return NextResponse.json(context);
}
