// DELETE /api/memory/redis-delete
// Deletes a memory entry from Redis by key.
import { NextRequest, NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis-client";

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key");

    if (!key) {
      return NextResponse.json({ error: "Missing key parameter" }, { status: 400 });
    }

    const redis = await getRedisClient();
    await redis.del(key);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[redis-delete] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Redis delete failed" },
      { status: 500 },
    );
  }
}
