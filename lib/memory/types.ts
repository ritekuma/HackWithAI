// ── Unified Memory Types ──
// Connects Python memory, Redis, TypeScript MemoryRegistry, and orchestration.

export type MemoryType =
  | "session"
  | "conversation"
  | "project"
  | "workspace"
  | "persistent"
  | "semantic"
  | "knowledge"
  | "experience"
  | "tool"
  | "agent";

export type MemoryPolicy = "volatile" | "short_term" | "long_term" | "permanent" | "archive";

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  metadata: Record<string, unknown>;
  policy: MemoryPolicy;
  createdAt: number;
  accessedAt: number;
  ttl?: number;           // seconds until expiry
  priority: number;       // 0-1, higher = more important
  embedding?: number[];   // vector embedding for semantic search
  sourceTaskId?: string;
  sourceAgentId?: string;
  compressed?: boolean;
  tags: string[];
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  source: "redis" | "semantic" | "knowledge";
}

export interface MemoryStats {
  totalEntries: number;
  byType: Record<MemoryType, number>;
  byPolicy: Record<MemoryPolicy, number>;
  redisKeys: number;
  embeddingCount: number;
  cacheHitRate: number;
  avgRetrievalMs: number;
  totalSizeBytes: number;
}

export interface KnowledgeEntity {
  id: string;
  type: "project" | "agent" | "file" | "tool" | "provider" | "user" | "task" | "conversation" | "document" | "error" | "fix";
  name: string;
  properties: Record<string, unknown>;
}

export interface KnowledgeRelationship {
  from: string;
  to: string;
  type: "uses" | "depends_on" | "created_by" | "fixes" | "related_to" | "calls" | "stores" | "retrieves" | "part_of";
  metadata?: Record<string, unknown>;
}

export interface ExperienceRecord {
  problem: string;
  solution: string;
  reasoning: string;
  toolsUsed: string[];
  filesModified: string[];
  executionTime: number;
  success: boolean;
  cost: number;
  agentId: string;
  taskId: string;
  timestamp: number;
  tags: string[];
}

export interface RetrievalContext {
  relevantMemories: MemorySearchResult[];
  experiences: ExperienceRecord[];
  knowledge: KnowledgeEntity[];
  sessionState: Record<string, unknown>;
  conversationSummary?: string;
}
