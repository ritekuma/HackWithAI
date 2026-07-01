// ── Provider interface ──

import type {
  ChatMessage,
  ChatOptions,
  StreamChunk,
  EmbeddingResult,
  Capability,
} from "../types";

export interface AIProvider {
  readonly id: string;
  readonly name: string;

  /** Supported capabilities */
  readonly capabilities: Capability[];

  /** List available models for this provider */
  listModels(): Promise<ProviderModel[]>;

  /** Non-streaming chat completion */
  chat(model: string, messages: ChatMessage[], options?: ChatOptions): Promise<ChatMessage>;

  /** Streaming chat completion — yields chunks via async iterable */
  stream(model: string, messages: ChatMessage[], options?: ChatOptions): AsyncIterable<StreamChunk>;

  /** Generate embeddings (if supported) */
  embed?(model: string, input: string | string[]): Promise<EmbeddingResult>;

  /** Health check — returns true if provider is reachable */
  healthCheck(): Promise<boolean>;
}

export interface ProviderModel {
  id: string;
  name: string;
  provider: string;
  capabilities: Capability[];
  contextWindow: number;
  maxOutputTokens: number;
  pricing?: {
    inputPer1k: number;
    outputPer1k: number;
  };
  aliases?: string[];
}

export interface ProviderConfig {
  id: string;
  name: string;
  apiKey?: string;
  baseURL?: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}
