// POST /api/memory/redis-set
// Stores a memory entry in Redis with optional TTL.
import { NextRequest, NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis-client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { key, value, ttl } = body;

    if (!key || value === undefined) {
      return NextResponse.json({ error: "Missing key or value" }, { status: 400 });
    }

    const redis = await getRedisClient();

    if (ttl && ttl > 0) {
      await redis.setEx(key, ttl, value);
    } else {
      await redis.set(key, value);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[redis-set] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Redis set failed" },
      { status: 500 },
    );
  }
}
