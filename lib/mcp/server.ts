// ── Base MCP Server ──
// Wraps an existing ToolRegistry into an MCP-compatible server.

import type {
  MCPServer,
  MCPServerConfig,
  MCPServerStatus,
  MCPToolCall,
  MCPToolResult,
  MCPToolDefinition,
} from "./types";

import type { RegisteredTool, ToolExecutor } from "@/lib/ai-runtime/tools/types";

export interface BaseServerOptions {
  config: MCPServerConfig;
  tools: RegisteredTool[];
  executors: Map<string, ToolExecutor>;
}

export class BaseMCPServer implements MCPServer {
  readonly config: MCPServerConfig;
  private tools: RegisteredTool[];
  private executors: Map<string, ToolExecutor>;
  private _status: MCPServerStatus = "disconnected";
  private _startTime = 0;

  constructor(options: BaseServerOptions) {
    this.config = options.config;
    this.tools = options.tools;
    this.executors = options.executors;
  }

  async start(): Promise<void> {
    this._status = "starting";
    this._startTime = Date.now();
    // Validate all tools have executors
    const missing = this.tools.filter((t) => !this.executors.has(t.id));
    if (missing.length > 0) {
      this._status = "error";
      throw new Error(
        `Missing executors for tools: ${missing.map((t) => t.id).join(", ")}`,
      );
    }
    this._status = "connected";
  }

  async stop(): Promise<void> {
    this._status = "disconnected";
    this._startTime = 0;
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    return this.tools.map((t) => ({
      name: t.id,
      description: t.description,
      inputSchema: {
        type: "object" as const,
        properties: (t.parameters as Record<string, unknown>) ?? {},
        required: t.permissions.length > 0 ? ["input"] : undefined,
      },
      permissions: t.permissions,
    }));
  }

  async callTool(call: MCPToolCall): Promise<MCPToolResult> {
    const tool = this.tools.find((t) => t.id === call.tool);
    if (!tool) {
      return { id: call.id, error: `Tool '${call.tool}' not found` };
    }

    const executor = this.executors.get(tool.id);
    if (!executor) {
      return { id: call.id, error: `No executor for tool '${call.tool}'` };
    }

    try {
      const result = await executor.execute(tool, call.arguments);
      return { id: call.id, result };
    } catch (e) {
      return {
        id: call.id,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async health(): Promise<MCPServerStatus> {
    return this._status;
  }

  getCapabilities(): string[] {
    return this.config.capabilities;
  }
}
