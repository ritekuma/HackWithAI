// @module governance/audit-trail v1.0.0 — Constitution decision audit persistence

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { PolicyDecision } from "./rule-engine";
import { randomUUID } from "crypto";

let auditDb: Database.Database | null = null;

function getAuditDb(): Database.Database {
  if (auditDb) return auditDb;

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "governance.db");
  auditDb = new Database(dbPath);
  auditDb.pragma("journal_mode = WAL");
  auditDb.pragma("synchronous = NORMAL");
  auditDb.pragma("busy_timeout = 5000");

  auditDb.exec(`
    CREATE TABLE IF NOT EXISTS audit_trail (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence TEXT,
      approver TEXT,
      policy TEXT,
      article TEXT,
      rule_id TEXT,
      context TEXT,
      outcome TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      mission_id TEXT,
      chat_id TEXT,
      user_id TEXT,
      executive_id TEXT,
      tool_name TEXT,
      correlation_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_trail(action);
    CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_trail(decision);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_mission ON audit_trail(mission_id);
    CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_trail(correlation_id);
  `);

  return auditDb;
}

export interface AuditEntry {
  id: string;
  action: string;
  decision: "allow" | "deny" | "require_evidence" | "require_approval" | "require_verification";
  reason: string;
  evidence?: string;
  approver?: string;
  policy?: string;
  article?: string;
  ruleId?: string;
  context: Record<string, unknown>;
  outcome: string;
  timestamp: number;
  missionId?: string;
  chatId?: string;
  userId?: string;
  executiveId?: string;
  toolName?: string;
  correlationId?: string;
}

export function recordAuditEntry(entry: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
  const db = getAuditDb();
  const id = `audit-${randomUUID()}`;
  const timestamp = Date.now();

  db.prepare(`
    INSERT INTO audit_trail (
      id, action, decision, reason, evidence, approver, policy, article, rule_id,
      context, outcome, timestamp, mission_id, chat_id, user_id, executive_id,
      tool_name, correlation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, entry.action, entry.decision, entry.reason,
    entry.evidence || null, entry.approver || null,
    entry.policy || null, entry.article || null, entry.ruleId || null,
    JSON.stringify(entry.context || {}), entry.outcome, timestamp,
    entry.missionId || null, entry.chatId || null,
    entry.userId || null, entry.executiveId || null,
    entry.toolName || null, entry.correlationId || null,
  );

  return { ...entry, id, timestamp };
}

export function recordPolicyDecision(
  action: string,
  decision: PolicyDecision,
  context: Record<string, unknown> = {},
  metadata: { missionId?: string; chatId?: string; userId?: string; executiveId?: string; toolName?: string; correlationId?: string } = {},
): AuditEntry[] {
  const entries: AuditEntry[] = [];

  for (const result of decision.results) {
    if (result.matched) {
      entries.push(recordAuditEntry({
        action,
        decision: result.effect.startsWith("allow") ? "allow" :
                   result.effect.startsWith("deny") ? "deny" :
                   result.effect.startsWith("require_approval") ? "require_approval" :
                   result.effect.startsWith("require_verification") ? "require_verification" :
                   "require_evidence",
        reason: result.reason,
        article: result.article,
        ruleId: result.ruleId,
        context: { ...context, matchedConditions: result.conditions.filter(c => c.matched).map(c => c.field) },
        outcome: decision.allowed ? "allowed" : "blocked",
        ...metadata,
      }));
    }
  }

  // Summary entry
  entries.push(recordAuditEntry({
    action,
    decision: decision.allowed ? "allow" : "deny",
    reason: decision.reasons.join("; "),
    context,
    outcome: decision.allowed ? "allowed" : "blocked",
    ...metadata,
  }));

  return entries;
}

export function queryAuditTrail(filter: {
  action?: string;
  decision?: string;
  missionId?: string;
  chatId?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
  offset?: number;
}): AuditEntry[] {
  const db = getAuditDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.action) { clauses.push("action = ?"); params.push(filter.action); }
  if (filter.decision) { clauses.push("decision = ?"); params.push(filter.decision); }
  if (filter.missionId) { clauses.push("mission_id = ?"); params.push(filter.missionId); }
  if (filter.chatId) { clauses.push("chat_id = ?"); params.push(filter.chatId); }
  if (filter.fromTimestamp) { clauses.push("timestamp >= ?"); params.push(filter.fromTimestamp); }
  if (filter.toTimestamp) { clauses.push("timestamp <= ?"); params.push(filter.toTimestamp); }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filter.limit || 100;
  const offset = filter.offset || 0;

  const rows = db.prepare(
    `SELECT * FROM audit_trail ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as Record<string, unknown>[];

  return rows.map(rowToAuditEntry);
}

export function getAuditCount(action?: string): number {
  const db = getAuditDb();
  if (action) {
    return (db.prepare("SELECT COUNT(*) as c FROM audit_trail WHERE action = ?").get(action) as { c: number }).c;
  }
  return (db.prepare("SELECT COUNT(*) as c FROM audit_trail").get() as { c: number }).c;
}

export function closeAuditDb(): void {
  if (auditDb) {
    auditDb.close();
    auditDb = null;
  }
}

function rowToAuditEntry(row: Record<string, unknown>): AuditEntry {
  return {
    id: row.id as string,
    action: row.action as string,
    decision: row.decision as AuditEntry["decision"],
    reason: row.reason as string,
    evidence: row.evidence as string | undefined,
    approver: row.approver as string | undefined,
    policy: row.policy as string | undefined,
    article: row.article as string | undefined,
    ruleId: row.rule_id as string | undefined,
    context: JSON.parse((row.context as string) || "{}"),
    outcome: row.outcome as string,
    timestamp: row.timestamp as number,
    missionId: row.mission_id as string | undefined,
    chatId: row.chat_id as string | undefined,
    userId: row.user_id as string | undefined,
    executiveId: row.executive_id as string | undefined,
    toolName: row.tool_name as string | undefined,
    correlationId: row.correlation_id as string | undefined,
  };
}
