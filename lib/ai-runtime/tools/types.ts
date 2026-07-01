// ── Tool types ──

import type { AIProvider } from "../providers/types";

export type ToolExecutionType = "local" | "sandbox" | "desktop" | "remote";

export interface RegisteredTool {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  requiredProvider?: string;
  executionType: ToolExecutionType;
  /** JSON Schema for tool parameters */
  parameters?: Record<string, unknown>;
  /** Whether this tool is available for AI function calling */
  callable: boolean;
}

export interface ToolExecutor {
  execute(tool: RegisteredTool, args: Record<string, unknown>, provider?: AIProvider): Promise<unknown>;
}
