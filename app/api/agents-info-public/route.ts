// Public mirror of /api/agents-info for monitoring/debugging.
// Returns the same 5-agent data without auth. Production: set AGENTS_INFO_PUBLIC=0.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.AGENTS_INFO_PUBLIC === "0") {
    return NextResponse.json({ error: "disabled" }, { status: 403 });
  }
  return NextResponse.json({
    agents: [
      { name: "ReconBot", role: "recon", model: "DeepSeek V4 Pro", elo: 1032, wins: 5, losses: 2, confidence: 0.85, tools: ["nmap","masscan","dnsrecon","gobuster","theHarvester"] },
      { name: "ExploitBot", role: "exploit", model: "Gemini 2.5 Pro", elo: 968, wins: 3, losses: 4, confidence: 0.58, tools: ["metasploit","sqlmap","hydra","searchsploit","john"] },
      { name: "PayloadBot", role: "payload", model: "Claude Sonnet", elo: 968, wins: 3, losses: 4, confidence: 0.62, tools: ["msfvenom","veil","shellter","upx","pyarmor"] },
      { name: "PostExploitBot", role: "post-exploit", model: "Kimi K2.7", elo: 968, wins: 3, losses: 4, confidence: 0.55, tools: ["mimikatz","bloodhound","impacket","evil-winrm","chisel"] },
      { name: "EvasionBot", role: "evasion", model: "Groq", elo: 968, wins: 3, losses: 4, confidence: 0.60, tools: ["amsi_patch","etw_patch","veil","shellter","upx"] },
    ],
    source: "agents-info-public (debug mirror)",
  });
}

