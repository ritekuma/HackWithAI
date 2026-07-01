// ── MCP Protocol Types ──
// Based on Model Context Protocol specification.
// Wraps the existing tool/sandbox/provider architecture.

import type { RegisteredTool, ToolExecutor } from "@/lib/ai-runtime/tools/types";

export type MCPServerStatus = "connected" | "disconnected" | "error" | "starting";

export interface MCPServerConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: string[];
  permissions: string[];
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface MCPServerHealth {
  id: string;
  name: string;
  status: MCPServerStatus;
  uptime: number;
  tools: number;
  error?: string;
  capabilities: string[];
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  permissions: string[];
}

export interface MCPToolCall {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  id: string;
  result?: unknown;
  error?: string;
}

export interface MCPServer {
  readonly config: MCPServerConfig;

  /** Lifecycle */
  start(): Promise<void>;
  stop(): Promise<void>;

  /** Tool discovery */
  listTools(): Promise<MCPToolDefinition[]>;

  /** Tool execution */
  callTool(call: MCPToolCall): Promise<MCPToolResult>;

  /** Health */
  health(): Promise<MCPServerStatus>;

  /** Capabilities */
  getCapabilities(): string[];
}

export interface MCPManagerHealth {
  servers: MCPServerHealth[];
  totalTools: number;
  connectedServers: number;
  errors: string[];
}
