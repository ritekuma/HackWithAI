// ── MCP Tool Call Endpoint ──
// POST /api/mcp/call — execute an MCP tool by name
// Routes to all registered servers, returns first successful result

import { NextRequest, NextResponse } from "next/server";
import { getMCPManager } from "@/lib/mcp";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, tool, arguments: args, server } = body as {
      id?: string;
      tool: string;
      arguments: Record<string, unknown>;
      server?: string;
    };

    if (!tool) {
      return NextResponse.json(
        { id, error: "Missing required field: tool" },
        { status: 400 },
      );
    }

    const manager = getMCPManager();

    // If a specific server is requested, route directly
    if (server) {
      const result = await manager.callTool(server, {
        id: id || "",
        tool,
        arguments: args || {},
      });
      return NextResponse.json(result);
    }

    // Try all enabled servers
    const servers = manager.listEnabled();
    for (const s of servers) {
      // Check if this server has the tool
      const tools = await s.listTools();
      if (!tools.some((t) => t.name === tool)) continue;

      try {
        const result = await s.callTool({
          id: id || "",
          tool,
          arguments: args || {},
        });
        if (result.result !== undefined || result.error) {
          return NextResponse.json(result);
        }
      } catch {
        // Try next server
      }
    }

    return NextResponse.json(
      {
        id: id || "",
        error: `Tool '${tool}' not found in any connected MCP server. Available tools: ${(await manager.listAllTools()).map((t) => t.name).join(", ")}`,
      },
      { status: 404 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
