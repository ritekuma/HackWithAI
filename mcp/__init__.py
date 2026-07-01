"""
HackWithAI MCP Integration Layer

Connects Python agents (agents/, swarm/, orchestrator/) to the
TypeScript MCP runtime via HTTP.

Usage:
    from mcp import MCPAdapter
    
    mcp = MCPAdapter()
    tools = mcp.list_available_tools()
    result = mcp.execute("desktop_execute", {"command": "whoami"})
"""

from .adapter import MCPAdapter
from .client import MCPClient

__all__ = ["MCPAdapter", "MCPClient"]
