import type { AIProvider, ProviderModel } from "./types";
import type { ChatMessage, ChatOptions, StreamChunk, Capability } from "../types";

const stubChat = async (): Promise<ChatMessage> => { throw new Error("Use lib/ai/providers.ts for production. AI Runtime provider is registry-only."); };
const stubStream = async function* (): AsyncIterable<StreamChunk> { throw new Error("Use lib/ai/providers.ts for production streaming."); };

export function createAnthropicProvider(): AIProvider {
  return {
    id: "anthropic",
    name: "Anthropic",
    capabilities: ["chat", "streaming"] as Capability[],
    async listModels(): Promise<ProviderModel[]> { return []; },
    chat: stubChat,
    stream: stubStream,
    async healthCheck(): Promise<boolean> { return true; },
  };
}
