// ── OpenRouter Provider (AI Runtime wrapper) ──
// Delegates to the production provider in lib/ai/providers.ts

import type { AIProvider, ProviderModel } from "./types";
import type { ChatMessage, ChatOptions, StreamChunk, Capability } from "../types";

export function createOpenRouterProvider(): AIProvider {
  return {
    id: "openrouter",
    name: "OpenRouter",
    capabilities: ["chat", "streaming", "tool_calling", "vision", "json_mode"] as Capability[],

    async listModels(): Promise<ProviderModel[]> {
      return [
        { id: "openai/gpt-4o", name: "GPT-4o", provider: "openrouter", capabilities: ["chat", "streaming", "tool_calling", "vision", "json_mode"], contextWindow: 128000, maxOutputTokens: 16384 },
        { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "openrouter", capabilities: ["chat", "streaming", "tool_calling", "vision"], contextWindow: 200000, maxOutputTokens: 64000 },
        { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "openrouter", capabilities: ["chat", "streaming"], contextWindow: 1048576, maxOutputTokens: 8192 },
      ];
    },

    async chat(_model: string, _messages: ChatMessage[], _options?: ChatOptions): Promise<ChatMessage> {
      throw new Error("Use lib/ai/providers.ts for production chat. AI Runtime provider is registry-only.");
    },

    async *stream(_model: string, _messages: ChatMessage[], _options?: ChatOptions): AsyncIterable<StreamChunk> {
      throw new Error("Use lib/ai/providers.ts for production streaming.");
    },

    async healthCheck(): Promise<boolean> {
      return true;
    },
  };
}
