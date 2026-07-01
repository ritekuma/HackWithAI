// ── MCP Tool Registry ──
// Discovers and registers every existing tool into MCP.
// Wraps existing lib/ai/tools without modifying them.

import type { RegisteredTool, ToolExecutionType } from "@/lib/ai-runtime/tools/types";

/** All tools available through MCP, wrapping existing implementations */
export const MCP_TOOLS: RegisteredTool[] = [
  // ── Terminal / Shell ──
  {
    id: "run_terminal_cmd",
    name: "Run Terminal Command",
    description: "Execute a shell command in the sandbox environment. Supports foreground, background, and interactive PTY sessions.",
    permissions: ["sandbox:execute"],
    requiredProvider: undefined,
    executionType: "sandbox",
    parameters: { command: "string", timeout: "number", interactive: "boolean", is_background: "boolean" },
    callable: true,
  },
  {
    id: "interact_terminal_session",
    name: "Interact Terminal Session",
    description: "Interact with persistent PTY shell sessions: view output, send input, wait for output, or kill the session.",
    permissions: ["sandbox:pty"],
    executionType: "sandbox",
    parameters: { action: "view|wait|send|kill", session: "string", input: "string", timeout: "number" },
    callable: true,
  },
  {
    id: "get_terminal_files",
    name: "Get Terminal Files",
    description: "Share files from the terminal sandbox as downloadable attachments. Uploads to Convex storage.",
    permissions: ["sandbox:read", "storage:write"],
    executionType: "sandbox",
    parameters: { files: "string[]" },
    callable: true,
  },

  // ── Filesystem ──
  {
    id: "file",
    name: "File Operations",
    description: "Read, write, append, edit, and view files in the sandbox. Supports image viewing, line-range reading, and multi-edit operations.",
    permissions: ["sandbox:read", "sandbox:write"],
    executionType: "sandbox",
    parameters: { action: "view|read|write|append|edit", path: "string", text: "string", range: "[number,number]", edits: "array" },
    callable: true,
  },

  // ── Web ──
  {
    id: "web_search",
    name: "Web Search",
    description: "Search the web using Perplexity AI. Supports 1-3 query variants, time filters, and Google dork syntax.",
    permissions: ["network:outbound"],
    requiredProvider: "openrouter",
    executionType: "remote",
    parameters: { queries: "string[]", time: "all|past_day|past_week|past_month|past_year" },
    callable: true,
  },
  {
    id: "open_url",
    name: "Open URL",
    description: "Fetch and read the contents of a webpage using Jina AI reader. Content truncated to ~2048 tokens.",
    permissions: ["network:outbound"],
    executionType: "remote",
    parameters: { url: "string" },
    callable: true,
  },

  // ── Task Management ──
  {
    id: "todo_write",
    name: "Write Todo List",
    description: "Create and manage a structured task list for penetration testing sessions. Supports merge and replace modes.",
    permissions: ["state:write"],
    executionType: "local",
    parameters: { merge: "boolean", todos: "array" },
    callable: true,
  },

  // ── Notes / Knowledge Base ──
  {
    id: "create_note",
    name: "Create Note",
    description: "Create a persistent note with markdown content, category, and tags. Survives chat sessions.",
    permissions: ["storage:write"],
    executionType: "remote",
    parameters: { title: "string", content: "string", category: "string", tags: "string[]" },
    callable: true,
  },
  {
    id: "list_notes",
    name: "List Notes",
    description: "List notes filtered by category, tags, or full-text search.",
    permissions: ["storage:read"],
    executionType: "remote",
    parameters: { category: "string", tags: "string[]", search: "string" },
    callable: true,
  },
  {
    id: "update_note",
    name: "Update Note",
    description: "Update a note's title, content, or tags.",
    permissions: ["storage:write"],
    executionType: "remote",
    parameters: { note_id: "string", title: "string", content: "string", tags: "string[]" },
    callable: true,
  },
  {
    id: "delete_note",
    name: "Delete Note",
    description: "Delete a note by ID.",
    permissions: ["storage:write"],
    executionType: "remote",
    parameters: { note_id: "string" },
    callable: true,
  },

  // ── Desktop Worker Tools ──
  {
    id: "desktop_execute",
    name: "Desktop Execute Command",
    description: "Execute a shell command directly on the desktop host via the Tauri IPC bridge. Requires DesktopSandboxBridge connected.",
    permissions: ["desktop:execute", "desktop:fs"],
    executionType: "desktop",
    parameters: { command: "string", cwd: "string", timeout_ms: "number", env: "object" },
    callable: true,
  },
  {
    id: "desktop_file_read",
    name: "Desktop Read File",
    description: "Read a file from the desktop host filesystem via the Tauri IPC bridge.",
    permissions: ["desktop:read"],
    executionType: "desktop",
    parameters: { path: "string" },
    callable: true,
  },
  {
    id: "desktop_file_write",
    name: "Desktop Write File",
    description: "Write content to a file on the desktop host filesystem.",
    permissions: ["desktop:write"],
    executionType: "desktop",
    parameters: { path: "string", content: "string" },
    callable: true,
  },
  {
    id: "desktop_pty_create",
    name: "Desktop PTY Create",
    description: "Create an interactive PTY terminal session on the desktop host.",
    permissions: ["desktop:pty"],
    executionType: "desktop",
    parameters: { command: "string", cols: "number", rows: "number", cwd: "string" },
    callable: true,
  },

  // ── Playwright / Browser ──
  {
    id: "playwright_navigate",
    name: "Playwright Navigate",
    description: "Navigate to a URL in a headless browser and return the page content.",
    permissions: ["browser:navigate"],
    executionType: "remote",
    parameters: { url: "string", waitFor: "string" },
    callable: true,
  },
  {
    id: "playwright_screenshot",
    name: "Playwright Screenshot",
    description: "Take a screenshot of the current page or a specific element.",
    permissions: ["browser:screenshot"],
    executionType: "remote",
    parameters: { selector: "string", fullPage: "boolean" },
    callable: true,
  },
  {
    id: "playwright_click",
    name: "Playwright Click",
    description: "Click an element on the page by selector or text.",
    permissions: ["browser:interact"],
    executionType: "remote",
    parameters: { selector: "string", text: "string" },
    callable: true,
  },
  {
    id: "playwright_fill",
    name: "Playwright Fill",
    description: "Fill a form field identified by selector.",
    permissions: ["browser:interact"],
    executionType: "remote",
    parameters: { selector: "string", value: "string" },
    callable: true,
  },
];
