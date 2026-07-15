// GET /api/memory/redis-get
// Retrieves a memory entry from Redis by key.
import { NextRequest, NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis-client";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key");

    if (!key) {
      return NextResponse.json({ error: "Missing key parameter" }, { status: 400 });
    }

    const redis = await getRedisClient();
    const value = await redis.get(key);

    if (value === null) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json(JSON.parse(value));
  } catch (error) {
    console.error("[redis-get] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Redis get failed" },
      { status: 500 },
    );
  }
}
