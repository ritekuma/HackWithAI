// ── Desktop Worker MCP Server ──
// Wraps the existing DesktopSandboxBridge and Tauri IPC as an MCP server.

import type {
  MCPServer,
  MCPServerConfig,
  MCPServerStatus,
  MCPToolCall,
  MCPToolResult,
  MCPToolDefinition,
} from "../types";

const CONFIG: MCPServerConfig = {
  id: "desktop-worker",
  name: "Desktop Worker",
  description: "MCP server for local desktop command execution, file access, and PTY sessions via Tauri IPC",
  version: "1.0.0",
  capabilities: ["command-execution", "filesystem", "pty", "desktop-access"],
  permissions: ["desktop:execute", "desktop:read", "desktop:write", "desktop:pty"],
  enabled: true,
};

const TOOLS: MCPToolDefinition[] = [
  {
    name: "desktop_execute",
    description: "Execute a shell command directly on the desktop host.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        cwd: { type: "string", description: "Working directory" },
        timeout_ms: { type: "number", description: "Timeout in milliseconds" },
        env: { type: "object", description: "Environment variables" },
      },
      required: ["command"],
    },
    permissions: ["desktop:execute"],
  },
  {
    name: "desktop_file_read",
    description: "Read a file from the desktop host filesystem.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute file path" },
      },
      required: ["path"],
    },
    permissions: ["desktop:read"],
  },
  {
    name: "desktop_file_write",
    description: "Write content to a file on the desktop host.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute file path" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
    permissions: ["desktop:write"],
  },
  {
    name: "desktop_pty_create",
    description: "Create an interactive PTY terminal session.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command (default: $SHELL)" },
        cols: { type: "number", description: "Terminal columns" },
        rows: { type: "number", description: "Terminal rows" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: [],
    },
    permissions: ["desktop:pty"],
  },
];

export class DesktopWorkerMCPServer implements MCPServer {
  readonly config = CONFIG;
  private _status: MCPServerStatus = "disconnected";
  private bridgeAvailable = false;

  async start(): Promise<void> {
    this._status = "starting";
    // Check if we're in a Tauri environment
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      this.bridgeAvailable = true;
      this._status = "connected";
    } else {
      this._status = "disconnected";
    }
  }

  async stop(): Promise<void> {
    this._status = "disconnected";
    this.bridgeAvailable = false;
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    return this.bridgeAvailable ? TOOLS : [];
  }

  async callTool(call: MCPToolCall): Promise<MCPToolResult> {
    if (!this.bridgeAvailable) {
      return { id: call.id, error: "Desktop worker not available (not in Tauri environment)" };
    }

    try {
      switch (call.tool) {
        case "desktop_execute": {
          const { invoke } = await import("@tauri-apps/api/core");
          const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
            "execute_command",
            {
              command: call.arguments.command,
              timeoutMs: call.arguments.timeout_ms ?? 30000,
              cwd: call.arguments.cwd,
              env: call.arguments.env,
            },
          );
          return { id: call.id, result };
        }
        case "desktop_file_read": {
          const { invoke } = await import("@tauri-apps/api/core");
          const fileData = await invoke<{ base64: string; mediaType: string; size: number }>(
            "read_local_file",
            { path: call.arguments.path },
          );
          return { id: call.id, result: fileData };
        }
        case "desktop_file_write": {
          const { invoke } = await import("@tauri-apps/api/core");
          // Use execute_command to write file content
          const cmd = `cat > '${(call.arguments.path as string).replace(/'/g, "'\\''")}'`;
          const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
            "execute_command",
            {
              command: cmd,
              timeoutMs: 5000,
            },
          );
          return { id: call.id, result };
        }
        case "desktop_pty_create": {
          const { invoke } = await import("@tauri-apps/api/core");
          const ptyResult = await invoke<{ pid: number | null; session_id: string }>(
            "execute_pty_create",
            {
              sessionId: `mcp-${Date.now()}`,
              command: call.arguments.command,
              cols: call.arguments.cols ?? 80,
              rows: call.arguments.rows ?? 24,
              cwd: call.arguments.cwd,
            },
          );
          return { id: call.id, result: ptyResult };
        }
        default:
          return { id: call.id, error: `Unknown tool: ${call.tool}` };
      }
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
