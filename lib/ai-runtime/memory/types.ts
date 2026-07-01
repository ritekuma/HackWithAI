// ── Memory interfaces (no implementations yet) ──

export interface SessionMemory {
  readonly id: string;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ConversationMemory {
  readonly id: string;
  addMessage(role: string, content: string, metadata?: Record<string, unknown>): Promise<void>;
  getMessages(limit?: number): Promise<ConversationEntry[]>;
  clear(): Promise<void>;
}

export interface ConversationEntry {
  role: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ProjectMemory {
  readonly id: string;
  setContext(key: string, value: unknown): Promise<void>;
  getContext<T>(key: string): Promise<T | undefined>;
  getAllContext(): Promise<Record<string, unknown>>;
  clear(): Promise<void>;
}

export interface VectorMemory {
  readonly id: string;
  store(vectors: number[][], metadata: Record<string, unknown>[]): Promise<void>;
  search(vector: number[], topK?: number): Promise<VectorSearchResult[]>;
  delete(ids: string[]): Promise<void>;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface PersistentMemory {
  readonly id: string;
  store<T>(key: string, value: T): Promise<void>;
  retrieve<T>(key: string): Promise<T | undefined>;
  list(): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export type MemoryServiceType = "session" | "conversation" | "project" | "vector" | "persistent";

export interface MemoryServiceEntry {
  type: MemoryServiceType;
  id: string;
  service: SessionMemory | ConversationMemory | ProjectMemory | VectorMemory | PersistentMemory;
  enabled: boolean;
}
