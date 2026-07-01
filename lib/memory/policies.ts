// ── Memory Policies ──
// Lifecycle management for memory entries.

import type { MemoryPolicy } from "./types";

export const POLICY_TTL: Record<MemoryPolicy, number> = {
  volatile: 300,          // 5 minutes
  short_term: 3600,       // 1 hour
  long_term: 86400,       // 24 hours
  permanent: 0,           // never expires
  archive: 0,             // never expires, compressed
};

export function getTTL(policy: MemoryPolicy): number {
  return POLICY_TTL[policy];
}

export function shouldCompress(policy: MemoryPolicy, accessedAt: number): boolean {
  if (policy === "archive") return true;
  if (policy === "long_term" && Date.now() - accessedAt > 86400 * 7 * 1000) return true;
  return false;
}

export function shouldArchive(policy: MemoryPolicy, accessedAt: number): boolean {
  if (policy === "permanent") return false;
  if (policy === "long_term" && Date.now() - accessedAt > 86400 * 30 * 1000) return true;
  if (policy === "short_term" && Date.now() - accessedAt > 3600 * 24 * 1000) return true;
  if (policy === "volatile" && Date.now() - accessedAt > 600 * 1000) return true;
  return false;
}

export function autoPolicy(entryType: string): MemoryPolicy {
  switch (entryType) {
    case "session": return "volatile";
    case "conversation": return "short_term";
    case "project": return "long_term";
    case "workspace": return "long_term";
    case "experience": return "permanent";
    case "semantic": return "permanent";
    case "knowledge": return "permanent";
    case "tool": return "long_term";
    case "agent": return "long_term";
    default: return "short_term";
  }
}

export function isExpired(createdAt: number, ttl: number): boolean {
  if (ttl <= 0) return false;
  return Date.now() - createdAt > ttl * 1000;
}
