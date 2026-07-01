// ── Unified Memory — Public API ──

export { UnifiedMemoryRegistry } from "./registry";
export { getMemory } from "./bootstrap";
export { RedisMemoryAdapter } from "./redis-adapter";
export { ExperienceEngine } from "./experience";
export { RetrievalEngine } from "./retrieval";
export { autoPolicy, getTTL, shouldCompress, shouldArchive, isExpired } from "./policies";

export type {
  MemoryType, MemoryPolicy, MemoryEntry, MemorySearchResult, MemoryStats,
  KnowledgeEntity, KnowledgeRelationship, ExperienceRecord, RetrievalContext,
} from "./types";
