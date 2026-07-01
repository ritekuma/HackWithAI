// ── Tool Registry ──

import type { RegisteredTool, ToolExecutor } from "./types";

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private executors = new Map<string, ToolExecutor>();

  register(tool: RegisteredTool, executor?: ToolExecutor): void {
    this.tools.set(tool.id, tool);
    if (executor) this.executors.set(tool.id, executor);
  }

  get(id: string): RegisteredTool | undefined {
    return this.tools.get(id);
  }

  list(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  listCallable(): RegisteredTool[] {
    return this.list().filter((t) => t.callable);
  }

  getExecutor(id: string): ToolExecutor | undefined {
    return this.executors.get(id);
  }

  count(): number {
    return this.tools.size;
  }
}
