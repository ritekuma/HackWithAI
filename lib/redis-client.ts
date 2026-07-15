// ── Server-side Redis Client ──
// Shared singleton Redis connection for API routes.
// Used by /api/memory/redis-* endpoints and the memory pipeline.

import { createClient, type RedisClientType } from "redis";

let _redis: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (_redis && _redis.isOpen) return _redis;

  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  _redis = createClient({ url });

  _redis.on("error", (err) => {
    console.error("[redis-client] connection error:", err.message);
  });

  await _redis.connect();
  console.error("[redis-client] connected to", url);
  return _redis;
}

export async function closeRedis(): Promise<void> {
  if (_redis && _redis.isOpen) {
    await _redis.quit();
    _redis = null;
  }
}
