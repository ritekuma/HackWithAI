// Public mirror of /api/burp/status for monitoring/debugging.
import { NextResponse } from "next/server";

const BURP_BASE = process.env.BURP_API_URL || "http://127.0.0.1:1337";
const BURP_API_KEY = process.env.BURP_API_KEY || "";

async function burpGET(path: string) {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (BURP_API_KEY) headers["Authorization"] = `Bearer ${BURP_API_KEY}`;
    const res = await fetch(`${BURP_BASE}${path}`, { headers, signal: AbortSignal.timeout(5000) });
    return await res.json();
  } catch { return null; }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.BURP_STATUS_PUBLIC === "0") {
    return NextResponse.json({ error: "disabled" }, { status: 403 });
  }
  const [scope, issues, history] = await Promise.all([
    burpGET("/burp/api/v2/target/scope"),
    burpGET("/burp/api/v2/scan/issues"),
    burpGET("/burp/api/v2/proxy/history?limit=20"),
  ]);
  return NextResponse.json({
    burp: {
      scope: scope?.data ?? null,
      issueCount: Array.isArray(issues?.data) ? issues.data.length : 0,
      historyCount: Array.isArray(history?.data) ? history.data.length : 0,
    },
    source: "burp/status-public (debug mirror)",
    note: "Burp Suite not running locally — fields are null (expected)",
  });
}

