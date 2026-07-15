// GET /api/memory/redis-list
// Lists Redis keys matching a pattern.
import { NextRequest, NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis-client";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const pattern = searchParams.get("pattern") || "*";

    const redis = await getRedisClient();
    const keys = await redis.keys(pattern);

    return NextResponse.json({ keys });
  } catch (error) {
    console.error("[redis-list] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Redis list failed" },
      { status: 500 },
    );
  }
}
