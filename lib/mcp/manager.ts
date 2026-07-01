// ── MCP Server Manager ──
// Central registry for all MCP servers.
// Wraps existing ToolRegistry for unified tool discovery.

import type {
  MCPServer,
  MCPServerConfig,
  MCPServerHealth,
  MCPManagerHealth,
  MCPToolCall,
  MCPToolResult,
  MCPToolDefinition,
} from "./types";

import type { RegisteredTool } from "@/lib/ai-runtime/tools/types";

export class MCPServerManager {
  private servers = new Map<string, MCPServer>();
  private startTimes = new Map<string, number>();
  private errors = new Map<string, string>();

  register(server: MCPServer): void {
    const id = server.config.id;
    this.servers.set(id, server);
    this.startTimes.set(id, 0);
    this.errors.delete(id);
  }

  get(id: string): MCPServer | undefined {
    return this.servers.get(id);
  }

  list(): MCPServerConfig[] {
    return Array.from(this.servers.values()).map((s) => s.config);
  }

  listEnabled(): MCPServer[] {
    return Array.from(this.servers.values()).filter((s) => s.config.enabled);
  }

  async startAll(): Promise<void> {
    for (const [id, server] of this.servers) {
      if (!server.config.enabled) continue;
      try {
        await server.start();
        this.startTimes.set(id, Date.now());
      } catch (e) {
        this.errors.set(id, e instanceof Error ? e.message : String(e));
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const server of this.servers.values()) {
      try { await server.stop(); } catch {}
    }
  }

  async listAllTools(): Promise<MCPToolDefinition[]> {
    const tools: MCPToolDefinition[] = [];
    for (const server of this.listEnabled()) {
      try {
        tools.push(...(await server.listTools()));
      } catch {}
    }
    return tools;
  }

  async callTool(serverId: string, call: MCPToolCall): Promise<MCPToolResult> {
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`MCP server '${serverId}' not found`);
    if (!server.config.enabled) throw new Error(`MCP server '${serverId}' is disabled`);
    return server.callTool(call);
  }

  async health(): Promise<MCPManagerHealth> {
    const servers: MCPServerHealth[] = [];
    let totalTools = 0;
    let connected = 0;

    for (const [id, server] of this.servers) {
      const status = await server.health();
      let toolCount = 0;
      try { toolCount = (await server.listTools()).length; } catch {}
      if (status === "connected") connected++;
      totalTools += toolCount;

      servers.push({
        id,
        name: server.config.name,
        status,
        uptime: this.startTimes.get(id) ? Date.now() - (this.startTimes.get(id) ?? 0) : 0,
        tools: toolCount,
        error: this.errors.get(id),
        capabilities: server.getCapabilities(),
      });
    }

    return {
      servers,
      totalTools,
      connectedServers: connected,
      errors: Array.from(this.errors.values()),
    };
  }
}
