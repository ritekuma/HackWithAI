// ── MCP Tool Integration ──
// Registers all MCP-discovered tools into the AI Runtime ToolRegistry.

import type { ToolRegistry } from "@/lib/ai-runtime/tools/registry";
import type { RegisteredTool, ToolExecutor } from "@/lib/ai-runtime/tools/types";
import { MCP_TOOLS } from "./registry";

let _managerPromise: Promise<any> | null = null;
function getMCPManagerAsync() {
  if (!_managerPromise) {
    _managerPromise = import("@/lib/mcp/bootstrap").then(m => m.getMCPManager());
  }
  return _managerPromise;
}

/**
 * Register all MCP-discovered tools into the provided ToolRegistry.
 * Each tool is registered with a real executor that delegates to the
 * appropriate MCP server via callTool dispatch.
 */
export function registerMCPTools(registry: ToolRegistry): void {
  const mcpExecutor: ToolExecutor = {
    async execute(tool: RegisteredTool, args: Record<string, unknown>): Promise<unknown> {
      try {
        const manager = await getMCPManagerAsync();
        const server = manager.getServerForTool?.(tool.id);
        if (server) {
          return await server.callTool({ id: tool.id, tool: tool.id, arguments: args });
        }
        // Fallback: try calling through the MCP API endpoint
        const res = await fetch("/api/mcp/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: tool.id, args }),
        });
        if (res.ok) return await res.json();
        return { error: `MCP tool '${tool.id}' execution failed: HTTP ${res.status}` };
      } catch (e: any) {
        return { error: `MCP tool '${tool.id}' not available in this environment: ${e.message}` };
      }
    },
  };

  for (const tool of MCP_TOOLS) {
    registry.register(tool, mcpExecutor);
  }
}
