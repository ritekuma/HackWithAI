// @module executive/decision-engine v1.0.0 — Formal executive decision engine

import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export type DecisionType = "approve" | "deny" | "delegate" | "escalate" | "verify" | "retry" | "abort";

export type DecisionConfidence = 0.0 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1.0;

export type DecisionStatus = "proposed" | "voting" | "approved" | "rejected" | "executed" | "overridden";

export interface DecisionVote {
  executiveId: string;
  executiveName: string;
  vote: "approve" | "reject" | "abstain";
  confidence: DecisionConfidence;
  reasoning: string;
  evidence?: Record<string, unknown>;
  timestamp: number;
}

export interface Decision {
  id: string;
  type: DecisionType;
  subject: string;
  context: Record<string, unknown>;
  status: DecisionStatus;
  proposedBy: string;
  proposedAt: number;
  votes: DecisionVote[];
  requiredApprovals: number;
  currentApprovals: number;
  currentRejections: number;
  finalDecision: DecisionType | null;
  confidence: DecisionConfidence;
  reasoning: string;
  evidence: Record<string, unknown>[];
  decidedAt?: number;
  executedAt?: number;
  delegatedTo?: string;
  escalatedTo?: string;
  missionId?: string;
  chatId?: string;
  toolName?: string;
  correlationId: string;
  timeline: DecisionTimelineEntry[];
}

export interface DecisionTimelineEntry {
  timestamp: number;
  event: string;
  actor: string;
  detail: string;
}

let decisionDb: Database.Database | null = null;

function getDecisionDb(): Database.Database {
  if (decisionDb) return decisionDb;
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "decisions.db");
  decisionDb = new Database(dbPath);
  decisionDb.pragma("journal_mode = WAL");
  decisionDb.pragma("synchronous = NORMAL");

  decisionDb.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'proposed',
      proposed_by TEXT NOT NULL,
      proposed_at INTEGER NOT NULL,
      votes_json TEXT NOT NULL DEFAULT '[]',
      required_approvals INTEGER NOT NULL DEFAULT 2,
      current_approvals INTEGER NOT NULL DEFAULT 0,
      current_rejections INTEGER NOT NULL DEFAULT 0,
      final_decision TEXT,
      confidence REAL NOT NULL DEFAULT 0.5,
      reasoning TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      decided_at INTEGER,
      executed_at INTEGER,
      delegated_to TEXT,
      escalated_to TEXT,
      mission_id TEXT,
      chat_id TEXT,
      tool_name TEXT,
      correlation_id TEXT NOT NULL,
      timeline_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
    CREATE INDEX IF NOT EXISTS idx_decisions_mission ON decisions(mission_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(proposed_at);
  `);
  return decisionDb;
}

export class DecisionEngine {
  createDecision(input: {
    type: DecisionType;
    subject: string;
    context?: Record<string, unknown>;
    proposedBy: string;
    requiredApprovals?: number;
    confidence?: DecisionConfidence;
    reasoning?: string;
    evidence?: Record<string, unknown>[];
    missionId?: string;
    chatId?: string;
    toolName?: string;
    delegatedTo?: string;
  }): Decision {
    const id = `dec-${randomUUID()}`;
    const now = Date.now();

    const decision: Decision = {
      id,
      type: input.type,
      subject: input.subject,
      context: input.context || {},
      status: "proposed",
      proposedBy: input.proposedBy,
      proposedAt: now,
      votes: [],
      requiredApprovals: input.requiredApprovals || 2,
      currentApprovals: 0,
      currentRejections: 0,
      finalDecision: null,
      confidence: input.confidence || 0.5,
      reasoning: input.reasoning || "",
      evidence: input.evidence || [],
      missionId: input.missionId,
      chatId: input.chatId,
      toolName: input.toolName,
      delegatedTo: input.delegatedTo,
      correlationId: randomUUID(),
      timeline: [{ timestamp: now, event: "proposed", actor: input.proposedBy, detail: `Decision proposed: ${input.type} — ${input.subject}` }],
    };

    this.persist(decision);
    return decision;
  }

  castVote(decisionId: string, vote: DecisionVote): Decision | null {
    const decision = this.get(decisionId);
    if (!decision) return null;
    if (decision.status !== "proposed" && decision.status !== "voting") return null;

    decision.status = "voting";
    decision.votes.push(vote);
    decision.timeline.push({ timestamp: Date.now(), event: "vote_cast", actor: vote.executiveName, detail: `${vote.vote.toUpperCase()} (confidence: ${vote.confidence}) — ${vote.reasoning}` });

    if (vote.vote === "approve") decision.currentApprovals++;
    else if (vote.vote === "reject") decision.currentRejections++;

    if (decision.currentApprovals >= decision.requiredApprovals) {
      decision.status = "approved";
      decision.finalDecision = decision.type;
      decision.decidedAt = Date.now();
      decision.timeline.push({ timestamp: Date.now(), event: "approved", actor: "board", detail: `${decision.currentApprovals}/${decision.requiredApprovals} approvals reached` });
    } else if (decision.currentRejections > (decision.requiredApprovals / 2)) {
      decision.status = "rejected";
      decision.finalDecision = "deny";
      decision.decidedAt = Date.now();
      decision.timeline.push({ timestamp: Date.now(), event: "rejected", actor: "board", detail: `${decision.currentRejections} rejections — quorum not met` });
    }

    this.persist(decision);
    return decision;
  }

  escalate(decisionId: string, escalatedTo: string): Decision | null {
    const decision = this.get(decisionId);
    if (!decision) return null;

    decision.type = "escalate";
    decision.escalatedTo = escalatedTo;
    decision.requiredApprovals += 1;
    decision.timeline.push({ timestamp: Date.now(), event: "escalated", actor: escalatedTo, detail: `Escalated to ${escalatedTo}` });
    this.persist(decision);
    return decision;
  }

  execute(decisionId: string): Decision | null {
    const decision = this.get(decisionId);
    if (!decision) return null;
    if (decision.status !== "approved") return null;

    decision.status = "executed";
    decision.executedAt = Date.now();
    decision.timeline.push({ timestamp: Date.now(), event: "executed", actor: "kernel", detail: "Decision executed" });
    this.persist(decision);
    return decision;
  }

  override(decisionId: string, overriddenBy: string, reason: string): Decision | null {
    const decision = this.get(decisionId);
    if (!decision) return null;

    decision.status = "overridden";
    decision.timeline.push({ timestamp: Date.now(), event: "overridden", actor: overriddenBy, detail: reason });
    this.persist(decision);
    return decision;
  }

  get(id: string): Decision | null {
    const db = getDecisionDb();
    const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToDecision(row) : null;
  }

  getByMission(missionId: string, limit = 50): Decision[] {
    const db = getDecisionDb();
    const rows = db.prepare("SELECT * FROM decisions WHERE mission_id = ? ORDER BY proposed_at DESC LIMIT ?").all(missionId, limit) as Record<string, unknown>[];
    return rows.map(rowToDecision);
  }

  getHistory(limit = 100): Decision[] {
    const db = getDecisionDb();
    const rows = db.prepare("SELECT * FROM decisions ORDER BY proposed_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map(rowToDecision);
  }

  private persist(decision: Decision): void {
    const db = getDecisionDb();
    db.prepare(`
      INSERT OR REPLACE INTO decisions (
        id, type, subject, context, status, proposed_by, proposed_at,
        votes_json, required_approvals, current_approvals, current_rejections,
        final_decision, confidence, reasoning, evidence_json, decided_at,
        executed_at, delegated_to, escalated_to, mission_id, chat_id, tool_name,
        correlation_id, timeline_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      decision.id, decision.type, decision.subject,
      JSON.stringify(decision.context), decision.status, decision.proposedBy,
      decision.proposedAt, JSON.stringify(decision.votes),
      decision.requiredApprovals, decision.currentApprovals,
      decision.currentRejections, decision.finalDecision,
      decision.confidence, decision.reasoning,
      JSON.stringify(decision.evidence), decision.decidedAt || null,
      decision.executedAt || null, decision.delegatedTo || null,
      decision.escalatedTo || null, decision.missionId || null,
      decision.chatId || null, decision.toolName || null,
      decision.correlationId, JSON.stringify(decision.timeline),
    );
  }
}

function rowToDecision(row: Record<string, unknown>): Decision {
  return {
    id: row.id as string,
    type: row.type as DecisionType,
    subject: row.subject as string,
    context: JSON.parse((row.context as string) || "{}"),
    status: row.status as DecisionStatus,
    proposedBy: row.proposed_by as string,
    proposedAt: row.proposed_at as number,
    votes: JSON.parse((row.votes_json as string) || "[]"),
    requiredApprovals: row.required_approvals as number,
    currentApprovals: row.current_approvals as number,
    currentRejections: row.current_rejections as number,
    finalDecision: row.final_decision as DecisionType | null,
    confidence: row.confidence as DecisionConfidence,
    reasoning: row.reasoning as string,
    evidence: JSON.parse((row.evidence_json as string) || "[]"),
    decidedAt: row.decided_at as number | undefined,
    executedAt: row.executed_at as number | undefined,
    delegatedTo: row.delegated_to as string | undefined,
    escalatedTo: row.escalated_to as string | undefined,
    missionId: row.mission_id as string | undefined,
    chatId: row.chat_id as string | undefined,
    toolName: row.tool_name as string | undefined,
    correlationId: row.correlation_id as string,
    timeline: JSON.parse((row.timeline_json as string) || "[]"),
  };
}

let engineInstance: DecisionEngine | null = null;
export function getDecisionEngine(): DecisionEngine {
  if (!engineInstance) engineInstance = new DecisionEngine();
  return engineInstance;
}
export function resetDecisionEngine(): void { engineInstance = null; }
