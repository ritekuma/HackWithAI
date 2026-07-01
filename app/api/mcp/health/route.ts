// ── MCP Health API ──
// GET /api/mcp/health → returns MCP server status and tool inventory

import { NextResponse } from "next/server";
import { getMCPManager } from "@/lib/mcp";

export async function GET() {
  const manager = getMCPManager();
  const health = await manager.health();
  const tools = await manager.listAllTools();

  return NextResponse.json({
    manager: health,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      permissions: t.permissions,
      inputSchema: t.inputSchema,
    })),
    totalTools: tools.length,
    connectedServers: health.connectedServers,
  });
}
