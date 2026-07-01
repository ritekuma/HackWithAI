"""
Python MCP Adapter — integration bridge for existing agents.

Usage from any Python agent:

    from mcp import MCPAdapter
    
    mcp = MCPAdapter()
    
    # Discover available tools
    tools = mcp.list_available_tools()
    
    # Execute a tool
    result = mcp.execute("run_terminal_cmd", {"command": "nmap -sV localhost"})
    
    # Convenience wrappers
    output = mcp.shell("whoami")
    files = mcp.read("/etc/passwd")
    page = mcp.browser("https://example.com")
"""

from .client import MCPClient
from typing import Any, Optional


class MCPAdapter:
    """
    High-level adapter that Python agents import.
    Provides a clean Pythonic API over the MCP layer.
    """

    def __init__(self, base_url: str = "http://localhost:3006"):
        self.client = MCPClient(base_url)

    # ── Discovery ────────────────────────────────────────────

    def list_available_tools(self) -> list[dict]:
        """Return all tools registered in the MCP layer."""
        return self.client.list_tools()

    def has_tool(self, name: str) -> bool:
        """Check if a specific tool is available."""
        return name in self.client.tool_names()

    def health(self) -> dict:
        """Get full MCP + Runtime health report."""
        return {
            "mcp": self.client.health(),
            "runtime": self.client.runtime_health(),
        }

    # ── Generic Execution ────────────────────────────────────

    def execute(self, tool: str, args: dict, server: Optional[str] = None) -> dict:
        """
        Execute any MCP tool by name.
        Returns {"id": ..., "result": ..., "error": ...}
        """
        return self.client.call_with_retry(tool, args)

    # ── Convenience Methods ──────────────────────────────────

    def shell(self, command: str, timeout_ms: int = 30000, cwd: Optional[str] = None) -> dict:
        """Execute a shell command on the desktop."""
        return self.client.execute_command(command, timeout_ms, cwd)

    def read(self, path: str) -> dict:
        """Read a file from the desktop filesystem."""
        return self.client.read_file(path)

    def write(self, path: str, content: str) -> dict:
        """Write content to a file on the desktop."""
        return self.client.write_file(path, content)

    def terminal(self, command: str, timeout: int = 60) -> dict:
        """Run a command in the sandbox terminal."""
        return self.client.run_terminal(command, timeout)

    def search(self, queries: list[str], time_filter: str = "all") -> dict:
        """Web search via Perplexity."""
        return self.client.web_search(queries, time_filter)

    def fetch_url(self, url: str) -> dict:
        """Fetch a webpage via Jina AI."""
        return self.client.open_url(url)

    def note_create(self, title: str, content: str, category: str = "general") -> dict:
        """Create a persistent note."""
        return self.client.create_note(title, content, category)

    def note_list(self, category: Optional[str] = None) -> dict:
        """List notes."""
        return self.client.list_notes(category)

    def browser(self, url: str) -> dict:
        """Navigate Playwright browser to a URL."""
        return self.client.playwright_navigate(url)

    def screenshot(self, full_page: bool = True) -> dict:
        """Take a Playwright screenshot."""
        return self.client.playwright_screenshot(full_page)

    # ── Agent-Friendly Methods ───────────────────────────────

    def agent_context(self) -> dict:
        """
        Return a context dict for AI agents describing available tools.
        Useful for system prompts and agent planning.
        """
        tools = self.list_available_tools()
        return {
            "available_tools": [
                {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("inputSchema", {}).get("properties", {}),
                    "permissions": t.get("permissions", []),
                }
                for t in tools
            ],
            "tool_count": len(tools),
        }

    def execute_plan(self, steps: list[dict]) -> list[dict]:
        """
        Execute a sequence of tool calls.
        Each step: {"tool": "name", "args": {...}}
        Returns list of results in order.
        """
        results = []
        for step in steps:
            result = self.execute(step["tool"], step.get("args", {}))
            results.append(result)
            # Stop on error unless step says to continue
            if result.get("error") and not step.get("continue_on_error"):
                break
        return results
