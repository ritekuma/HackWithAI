// ── Redis Memory Adapter ──
// Wraps existing Redis for session, task, agent state, conversation cache.

import type { MemoryEntry } from "./types";

const PREFIX = "hwai:mem:";

export class RedisMemoryAdapter {
  private hits = 0;
  private misses = 0;

  async set(entry: MemoryEntry): Promise<void> {
    const url = `http://localhost:${process.env.PORT || 3006}/api/memory/redis-set`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: `${PREFIX}${entry.id}`, value: JSON.stringify(entry), ttl: entry.ttl || 0 }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Redis SET failed (${res.status}): ${body}`);
    }
    this.hits++;
  }

  async get(key: string): Promise<MemoryEntry | null> {
    const url = `http://localhost:${process.env.PORT || 3006}/api/memory/redis-get?key=${encodeURIComponent(PREFIX + key)}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Redis GET failed (${res.status})`);
    }
    this.hits++;
    return (await res.json()) as MemoryEntry;
  }

  async delete(key: string): Promise<void> {
    const url = `http://localhost:${process.env.PORT || 3006}/api/memory/redis-delete?key=${encodeURIComponent(PREFIX + key)}`;
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`Redis DELETE failed (${res.status})`);
    }
  }

  async list(pattern: string = "*"): Promise<string[]> {
    const url = `http://localhost:${process.env.PORT || 3006}/api/memory/redis-list?pattern=${encodeURIComponent(PREFIX + pattern)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Redis LIST failed (${res.status})`);
    }
    const data = await res.json();
    return (data.keys || []).map((k: string) => k.replace(PREFIX, ""));
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
