// ── AI Runtime — public API ──

export { RuntimeManager } from "./manager";
export type { RuntimeConfig } from "./manager";

export { ProviderRegistry } from "./providers/registry";
export type { AIProvider, ProviderModel, ProviderConfig } from "./providers/types";

export { ModelRegistry } from "./models/registry";
export type { ModelEntry, ModelFilter } from "./models/types";

export { ToolRegistry } from "./tools/registry";
export type { RegisteredTool, ToolExecutor, ToolExecutionType } from "./tools/types";

export { MemoryRegistry } from "./memory/registry";
export type {
  SessionMemory,
  ConversationMemory,
  ConversationEntry,
  ProjectMemory,
  VectorMemory,
  VectorSearchResult,
  PersistentMemory,
  MemoryServiceType,
  MemoryServiceEntry,
} from "./memory/types";

export type {
  RuntimeHealth,
  RuntimeStatus,
  ProviderHealth,
  ChatMessage,
  ChatOptions,
  StreamChunk,
  EmbeddingResult,
  Capability,
  MessageRole,
  ToolCall,
} from "./types";
