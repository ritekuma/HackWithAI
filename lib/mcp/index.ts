// ── MCP Index — public API ──

export { MCPServerManager } from "./manager";
export { BaseMCPServer } from "./server";
export type { BaseServerOptions } from "./server";
export { DesktopWorkerMCPServer } from "./servers/desktop-worker";
export { PlaywrightMCPServer } from "./servers/playwright";
export { getMCPManager } from "./bootstrap";
export { MCP_TOOLS } from "./tools/registry";

export type {
  MCPServer,
  MCPServerConfig,
  MCPServerHealth,
  MCPServerStatus,
  MCPManagerHealth,
  MCPToolDefinition,
  MCPToolCall,
  MCPToolResult,
} from "./types";
