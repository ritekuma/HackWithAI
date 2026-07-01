// ── MCP Bootstrap ──
// Initializes the MCP Server Manager with all available servers.

import { MCPServerManager } from "./manager";
import { DesktopWorkerMCPServer } from "./servers/desktop-worker";
import { PlaywrightMCPServer } from "./servers/playwright";

let _mcpManager: MCPServerManager | null = null;

export function getMCPManager(): MCPServerManager {
  if (!_mcpManager) {
    _mcpManager = bootstrapMCP();
  }
  return _mcpManager;
}

function bootstrapMCP(): MCPServerManager {
  const manager = new MCPServerManager();

  // Register Desktop Worker (available only in Tauri environment)
  manager.register(new DesktopWorkerMCPServer());

  // Register Playwright (available when proxy is running)
  manager.register(new PlaywrightMCPServer());

  // Start all enabled servers in background
  manager.startAll().catch(() => {});

  return manager;
}
