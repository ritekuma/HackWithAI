// Public mirror of /api/knowledge-graph for monitoring/debugging.
// Returns stats from python core.knowledge_graph (or zero defaults if missing).
import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.KNOWLEDGE_GRAPH_PUBLIC === "0") {
    return NextResponse.json({ error: "disabled" }, { status: 403 });
  }
  try {
    const { stdout } = await execAsync(
      `cd /home/kali/HackWithAI && python3 -c "
import sys, json
sys.path.insert(0, '.')
try:
  from core.knowledge_graph import get_knowledge_graph
  kg = get_knowledge_graph()
  print(json.dumps(kg.stats()))
except Exception as e:
  print(json.dumps({'total_nodes': 0, 'total_edges': 0, 'note': str(e)}))
"`,
      { timeout: 5000 }
    );
    return NextResponse.json(JSON.parse(stdout));
  } catch {
    return NextResponse.json({ total_nodes: 0, total_edges: 0, note: "graph unavailable" });
  }
}

