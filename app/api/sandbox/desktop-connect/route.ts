import { NextRequest, NextResponse } from "next/server";
import { generateCentrifugoToken } from "@/lib/centrifugo/jwt";

export async function POST(request: NextRequest) {
  try {
    const { connectionName } = await request.json();
    const userId = (connectionName as string)?.replace(/[^a-zA-Z0-9_-]/g, "_") || "desktop-user";

    const centrifugoToken = await generateCentrifugoToken(userId, 3600);

    return NextResponse.json({
      centrifugoToken,
      connectionId: `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    });
  } catch (err) {
    console.error("[Desktop Connect] Failed to generate token:", err);
    return NextResponse.json(
      { error: "Failed to generate Centrifugo token" },
      { status: 500 },
    );
  }
}
