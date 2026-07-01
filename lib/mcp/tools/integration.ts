// ── MCP Tool Integration ──
// Registers all MCP-discovered tools into the AI Runtime ToolRegistry.

import type { ToolRegistry } from "@/lib/ai-runtime/tools/registry";
import type { RegisteredTool, ToolExecutor } from "@/lib/ai-runtime/tools/types";
import { MCP_TOOLS } from "./registry";

/**
 * Register all MCP-discovered tools into the provided ToolRegistry.
 * Each tool is registered WITHOUT an executor — the MCP server layer
 * handles execution via its own callTool dispatch.
 */
export function registerMCPTools(registry: ToolRegistry): void {
  const mcpExecutor: ToolExecutor = {
    async execute(tool: RegisteredTool, args: Record<string, unknown>): Promise<unknown> {
      // Execution is handled by the MCP server layer via callTool.
      // This executor is a placeholder for the ToolRegistry contract.
      throw new Error(
        `Tool '${tool.id}' is an MCP-registered tool. Use the MCP server layer for execution.`,
      );
    },
  };

  for (const tool of MCP_TOOLS) {
    registry.register(tool, mcpExecutor);
  }
}
