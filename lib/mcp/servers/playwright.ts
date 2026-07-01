// ── Playwright MCP Server ──
// Wraps the existing Playwright installation as an MCP server.

import type {
  MCPServer,
  MCPServerConfig,
  MCPServerStatus,
  MCPToolCall,
  MCPToolResult,
  MCPToolDefinition,
} from "../types";

const CONFIG: MCPServerConfig = {
  id: "playwright",
  name: "Playwright Browser",
  description: "MCP server for browser automation via Playwright — navigation, screenshots, interaction",
  version: "1.0.0",
  capabilities: ["browser-navigate", "browser-screenshot", "browser-interact"],
  permissions: ["browser:navigate", "browser:screenshot", "browser:interact"],
  enabled: true,
};

const TOOLS: MCPToolDefinition[] = [
  {
    name: "playwright_navigate",
    description: "Navigate to a URL and return page content.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to" },
        waitFor: { type: "string", description: "Selector to wait for after load" },
      },
      required: ["url"],
    },
    permissions: ["browser:navigate"],
  },
  {
    name: "playwright_screenshot",
    description: "Take a screenshot of the current page or element.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element screenshot" },
        fullPage: { type: "boolean", description: "Capture full scrollable page" },
      },
      required: [],
    },
    permissions: ["browser:screenshot"],
  },
  {
    name: "playwright_click",
    description: "Click an element identified by selector or text.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector" },
        text: { type: "string", description: "Text content to match" },
      },
      required: [],
    },
    permissions: ["browser:interact"],
  },
  {
    name: "playwright_fill",
    description: "Fill a form field identified by selector.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the input" },
        value: { type: "string", description: "Value to fill" },
      },
      required: ["selector", "value"],
    },
    permissions: ["browser:interact"],
  },
];

export class PlaywrightMCPServer implements MCPServer {
  readonly config = CONFIG;
  private _status: MCPServerStatus = "disconnected";
  private available = false;

  async start(): Promise<void> {
    this._status = "starting";
    try {
      // Check if Playwright API is reachable
      const res = await fetch("/api/playwright-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "health" }),
      });
      this.available = res.ok;
      this._status = this.available ? "connected" : "disconnected";
    } catch {
      this.available = false;
      this._status = "disconnected";
    }
  }

  async stop(): Promise<void> {
    this._status = "disconnected";
    this.available = false;
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    return this.available ? TOOLS : [];
  }

  async callTool(call: MCPToolCall): Promise<MCPToolResult> {
    if (!this.available) {
      return { id: call.id, error: "Playwright not available. Is the proxy running?" };
    }

    try {
      const res = await fetch("/api/playwright-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: call.tool.replace("playwright_", ""),
          ...call.arguments,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return { id: call.id, error: err || `Playwright request failed: ${res.status}` };
      }

      const data = await res.json();
      return { id: call.id, result: data };
    } catch (e) {
      return { id: call.id, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async health(): Promise<MCPServerStatus> {
    return this._status;
  }

  getCapabilities(): string[] {
    return CONFIG.capabilities;
  }
}
