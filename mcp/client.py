"""
Python MCP Client — communicates with the TypeScript MCP layer via HTTP.
Provides tool discovery, execution, and health checks.
"""
import json
import time
import urllib.request
import urllib.error
from typing import Any, Optional

DEFAULT_BASE_URL = "http://localhost:3006"


class MCPClient:
    """HTTP client for the HackWithAI MCP layer."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._tools_cache: Optional[list[dict]] = None
        self._cache_time = 0.0
        self._cache_ttl = 60.0

    # ── Health ──────────────────────────────────────────────

    def health(self) -> dict:
        """Get MCP manager health status."""
        return self._get("/api/mcp/health")

    def runtime_health(self) -> dict:
        """Get AI Runtime health status."""
        return self._get("/api/runtime/health")

    # ── Tool Discovery ──────────────────────────────────────

    def list_tools(self, refresh: bool = False) -> list[dict]:
        """List all available MCP tools. Results cached for 60s."""
        now = time.time()
        if not refresh and self._tools_cache and (now - self._cache_time) < self._cache_ttl:
            return self._tools_cache

        data = self.health()
        tools = data.get("tools", [])
        self._tools_cache = tools
        self._cache_time = now
        return tools

    def get_tool(self, name: str) -> Optional[dict]:
        """Get a specific tool by name."""
        for tool in self.list_tools():
            if tool.get("name") == name:
                return tool
        return None

    def tool_names(self) -> list[str]:
        """Get list of available tool names."""
        return [t["name"] for t in self.list_tools()]

    # ── Tool Execution ──────────────────────────────────────

    def call(self, tool: str, args: dict, server: Optional[str] = None) -> dict:
        """
        Call an MCP tool.
        
        Args:
            tool: Tool name (e.g. 'run_terminal_cmd', 'desktop_execute')
            args: Tool arguments
            server: Optional server ID to target (e.g. 'desktop-worker')
        
        Returns:
            {
                "id": str,
                "result": ... | None,
                "error": str | None
            }
        """
        import uuid
        call_id = str(uuid.uuid4())[:8]
        payload = {
            "id": call_id,
            "tool": tool,
            "arguments": args,
        }
        if server:
            payload["server"] = server

        return self._post("/api/mcp/call", payload)

    def call_with_retry(self, tool: str, args: dict, retries: int = 2) -> dict:
        """Call with retry on transient errors."""
        last_error = None
        for attempt in range(retries + 1):
            result = self.call(tool, args)
            if result.get("result") is not None:
                return result
            if result.get("error"):
                last_error = result["error"]
                if attempt < retries:
                    time.sleep(1.0 * (attempt + 1))
        return {"id": "", "result": None, "error": last_error or "All retries failed"}

    # ── Convenience Methods ─────────────────────────────────

    def execute_command(self, command: str, timeout_ms: int = 30000, cwd: Optional[str] = None) -> dict:
        """Execute a shell command via the desktop worker."""
        return self.call("desktop_execute", {
            "command": command,
            "timeout_ms": timeout_ms,
            "cwd": cwd or "",
        })

    def read_file(self, path: str) -> dict:
        """Read a file from the desktop filesystem."""
        return self.call("desktop_file_read", {"path": path})

    def write_file(self, path: str, content: str) -> dict:
        """Write content to a file on the desktop filesystem."""
        return self.call("desktop_file_write", {"path": path, "content": content})

    def run_terminal(self, command: str, timeout: int = 60) -> dict:
        """Run a terminal command in the sandbox."""
        return self.call("run_terminal_cmd", {
            "command": command,
            "timeout": timeout,
            "brief": f"Execute: {command[:80]}",
        })

    def web_search(self, queries: list[str], time_filter: str = "all") -> dict:
        """Search the web via Perplexity."""
        return self.call("web_search", {
            "queries": queries,
            "time": time_filter,
        })

    def open_url(self, url: str) -> dict:
        """Fetch a webpage via Jina AI."""
        return self.call("open_url", {"url": url, "brief": f"Fetch {url[:60]}"})

    def create_note(self, title: str, content: str, category: str = "general") -> dict:
        """Create a persistent note."""
        return self.call("create_note", {
            "title": title,
            "content": content,
            "category": category,
        })

    def list_notes(self, category: Optional[str] = None) -> dict:
        """List notes, optionally filtered."""
        args = {}
        if category:
            args["category"] = category
        return self.call("list_notes", args)

    def playwright_navigate(self, url: str) -> dict:
        """Navigate the Playwright browser to a URL."""
        return self.call("playwright_navigate", {"url": url})

    def playwright_screenshot(self, full_page: bool = True) -> dict:
        """Take a Playwright screenshot."""
        return self.call("playwright_screenshot", {"fullPage": full_page})

    # ── HTTP Helpers ────────────────────────────────────────

    def _get(self, path: str) -> dict:
        url = f"{self.base_url}{path}"
        try:
            req = urllib.request.Request(url, method="GET")
            req.add_header("Accept", "application/json")
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            return {"error": f"HTTP {e.code}: {e.reason}", "status": e.code}
        except urllib.error.URLError as e:
            return {"error": f"Connection failed: {e.reason}", "status": 0}
        except json.JSONDecodeError as e:
            return {"error": f"Invalid JSON response: {e}", "status": 0}
        except Exception as e:
            return {"error": str(e), "status": 0}

    def _post(self, path: str, payload: dict) -> dict:
        url = f"{self.base_url}{path}"
        data = json.dumps(payload).encode("utf-8")
        try:
            req = urllib.request.Request(url, method="POST", data=data)
            req.add_header("Content-Type", "application/json")
            req.add_header("Accept", "application/json")
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            return {"id": payload.get("id", ""), "error": f"HTTP {e.code}: {e.reason}", "result": None}
        except urllib.error.URLError as e:
            return {"id": payload.get("id", ""), "error": f"Connection failed: {e.reason}", "result": None}
        except json.JSONDecodeError:
            return {"id": payload.get("id", ""), "error": "Invalid JSON response", "result": None}
        except Exception as e:
            return {"id": payload.get("id", ""), "error": str(e), "result": None}
