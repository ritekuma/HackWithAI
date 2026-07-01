// ── Unified Memory Registry ──
// Single entry point for all memory operations.
// Wraps Redis, Experience Engine, Retrieval Engine, and Knowledge Graph.

import type { MemoryEntry, MemorySearchResult, MemoryStats, MemoryType, ExperienceRecord, KnowledgeEntity, KnowledgeRelationship, RetrievalContext } from "./types";
import type { OrchestrationTask } from "@/lib/orchestration/types";
import { RedisMemoryAdapter } from "./redis-adapter";
import { ExperienceEngine } from "./experience";
import { RetrievalEngine } from "./retrieval";
import { autoPolicy, shouldCompress, shouldArchive, isExpired, getTTL } from "./policies";

export class UnifiedMemoryRegistry {
  readonly redis = new RedisMemoryAdapter();
  readonly experience = new ExperienceEngine();
  readonly retrieval = new RetrievalEngine(this.redis, this.experience);

  private knowledgeEntities = new Map<string, KnowledgeEntity>();
  private relationships: KnowledgeRelationship[] = [];

  // ── CRUD ─────────────────────────────────────────────

  async store(entry: MemoryEntry): Promise<void> {
    if (!entry.policy) entry.policy = autoPolicy(entry.type);
    if (!entry.ttl) entry.ttl = getTTL(entry.policy);
    await this.redis.set(entry);
  }

  async retrieve(key: string): Promise<MemoryEntry | null> {
    return this.redis.get(key);
  }

  async remove(key: string): Promise<void> {
    await this.redis.delete(key);
  }

  async search(query: string, type?: MemoryType, limit = 10): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = [];

    // Search in-memory experience records
    const experiences = this.experience.getAll();
    for (const exp of experiences) {
      const score = this.textMatch(query, exp.problem + " " + exp.solution);
      if (score > 0) {
        results.push({
          entry: this.experience.toMemoryEntry(exp),
          score,
          source: "knowledge",
        });
      }
    }

    // Search knowledge entities
    for (const entity of this.knowledgeEntities.values()) {
      const score = this.textMatch(query, entity.name + " " + Object.values(entity.properties).join(" "));
      if (score > 0) {
        results.push({
          entry: {
            id: entity.id,
            type: "knowledge",
            content: JSON.stringify(entity),
            metadata: entity.properties,
            policy: "permanent",
            createdAt: 0,
            accessedAt: Date.now(),
            priority: 0.5,
            tags: [entity.type],
          },
          score,
          source: "knowledge",
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ── Task Integration ────────────────────────────────

  /** Called BEFORE task execution — gather context */
  async beforeTask(task: OrchestrationTask): Promise<RetrievalContext> {
    return this.retrieval.gather(task);
  }

  /** Called AFTER task execution — store experiences */
  async afterTask(task: OrchestrationTask): Promise<ExperienceRecord[]> {
    const records = this.experience.capture(task);
    for (const record of records) {
      const entry = this.experience.toMemoryEntry(record);
      await this.store(entry);
    }
    return records;
  }

  // ── Knowledge Graph ─────────────────────────────────

  addEntity(entity: KnowledgeEntity): void {
    this.knowledgeEntities.set(entity.id, entity);
  }

  addRelationship(rel: KnowledgeRelationship): void {
    this.relationships.push(rel);
  }

  getEntities(): KnowledgeEntity[] {
    return Array.from(this.knowledgeEntities.values());
  }

  getRelationships(): KnowledgeRelationship[] {
    return this.relationships;
  }

  // ── Maintenance ─────────────────────────────────────

  async cleanup(): Promise<number> {
    let cleaned = 0;
    const keys = await this.redis.list();
    for (const key of keys) {
      const entry = await this.redis.get(key);
      if (!entry) continue;
      if (isExpired(entry.createdAt, entry.ttl || 0)) {
        await this.redis.delete(key);
        cleaned++;
        continue;
      }
      if (shouldCompress(entry.policy, entry.accessedAt) && !entry.compressed) {
        entry.compressed = true;
        entry.content = entry.content.slice(0, 2048); // Truncate
        await this.redis.set(entry);
        cleaned++;
      }
    }
    return cleaned;
  }

  // ── Stats ────────────────────────────────────────────

  getStats(): MemoryStats {
    const redis = this.redis.getStats();
    const exp = this.experience.getStats();
    return {
      totalEntries: exp.total + this.knowledgeEntities.size,
      byType: {
        session: 0, conversation: 0, project: 0, workspace: 0,
        persistent: 0, semantic: 0, knowledge: this.knowledgeEntities.size,
        experience: exp.total, tool: 0, agent: 0,
      },
      byPolicy: {
        volatile: 0, short_term: 0, long_term: 0, permanent: exp.total + this.knowledgeEntities.size, archive: 0,
      },
      redisKeys: redis.hits + redis.misses,
      embeddingCount: 0,
      cacheHitRate: redis.hitRate,
      avgRetrievalMs: 5, // estimated
      totalSizeBytes: 0,
    };
  }

  private textMatch(query: string, text: string): number {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let score = 0;
    for (const word of q.split(/\s+/)) {
      if (word.length < 2) continue;
      if (t.includes(word)) score += 1;
    }
    return score / Math.max(1, q.split(/\s+/).length);
  }
}
