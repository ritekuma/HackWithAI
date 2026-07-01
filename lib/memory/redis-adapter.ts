// ── Redis Memory Adapter ──
// Wraps existing Redis for session, task, agent state, conversation cache.

import type { MemoryEntry } from "./types";

const PREFIX = "hwai:mem:";

export class RedisMemoryAdapter {
  private hits = 0;
  private misses = 0;

  async set(entry: MemoryEntry): Promise<void> {
    // Use fetch to call a Redis-compatible API endpoint
    try {
      await fetch("http://localhost:3006/api/memory/redis-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: `${PREFIX}${entry.id}`, value: JSON.stringify(entry), ttl: entry.ttl || 0 }),
      });
      this.hits++;
    } catch {
      this.misses++;
    }
  }

  async get(key: string): Promise<MemoryEntry | null> {
    try {
      const res = await fetch(`http://localhost:3006/api/memory/redis-get?key=${encodeURIComponent(PREFIX + key)}`);
      if (!res.ok) { this.misses++; return null; }
      this.hits++;
      return (await res.json()) as MemoryEntry;
    } catch {
      this.misses++;
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fetch(`http://localhost:3006/api/memory/redis-delete?key=${encodeURIComponent(PREFIX + key)}`, { method: "DELETE" });
    } catch {}
  }

  async list(pattern: string = "*"): Promise<string[]> {
    try {
      const res = await fetch(`http://localhost:3006/api/memory/redis-list?pattern=${encodeURIComponent(PREFIX + pattern)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.keys || []).map((k: string) => k.replace(PREFIX, ""));
    } catch {
      return [];
    }
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hitRate: total > 0 ? this.hits / total : 1,
      hits: this.hits,
      misses: this.misses,
    };
  }
}
