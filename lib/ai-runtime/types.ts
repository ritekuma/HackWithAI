// ── Core types for the AI Runtime ──

import type { RegisteredTool } from "./tools/types";

export type RuntimeStatus = "starting" | "running" | "degraded" | "stopped";

export interface RuntimeHealth {
  status: RuntimeStatus;
  uptime: number;
  providers: ProviderHealth[];
  models: number;
  tools: number;
  memoryServices: number;
  startupErrors: string[];
}

export interface ProviderHealth {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "error";
  models: string[];
  error?: string;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  tools?: RegisteredTool[];
  toolChoice?: "auto" | "none" | "required";
}

export interface StreamChunk {
  type: "text" | "tool_call" | "tool_result" | "error" | "done";
  content?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
}

export interface EmbeddingResult {
  embedding: number[];
  tokens: number;
}

export type Capability = "chat" | "streaming" | "embeddings" | "tool_calling" | "vision" | "json_mode";
