// @module mission-kernel/timeline v1.0.0 — Mission event timeline persistence

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

let tlDb: Database.Database | null = null;

function getTimelineDb(): Database.Database {
  if (tlDb) return tlDb;

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "mission-timeline.db");
  tlDb = new Database(dbPath);
  tlDb.pragma("journal_mode = WAL");
  tlDb.pragma("synchronous = NORMAL");
  tlDb.pragma("busy_timeout = 5000");

  tlDb.exec(`
    CREATE TABLE IF NOT EXISTS mission_timeline (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      type TEXT NOT NULL,
      actor TEXT,
      detail TEXT,
      evidence TEXT,
      metadata TEXT DEFAULT '{}',
      timestamp INTEGER NOT NULL,
      correlation_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mtl_mission ON mission_timeline(mission_id);
    CREATE INDEX IF NOT EXISTS idx_mtl_type ON mission_timeline(type);
    CREATE INDEX IF NOT EXISTS idx_mtl_timestamp ON mission_timeline(timestamp);
    CREATE INDEX IF NOT EXISTS idx_mtl_correlation ON mission_timeline(correlation_id);
  `);

  return tlDb;
}

export interface TimelineEntry {
  id: string;
  missionId: string;
  type: "state_change" | "tool_call" | "executive_decision" | "evidence" | "checkpoint" | "recovery" | "error" | "plan_step" | "completion" | "user_action";
  actor?: string;
  detail: string;
  evidence?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  timestamp: number;
  correlationId?: string;
}

export function recordTimelineEntry(entry: Omit<TimelineEntry, "id" | "timestamp">): TimelineEntry {
  const db = getTimelineDb();
  const id = `mtl-${randomUUID()}`;
  const timestamp = Date.now();

  db.prepare(`
    INSERT INTO mission_timeline (id, mission_id, type, actor, detail, evidence, metadata, timestamp, correlation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, entry.missionId, entry.type, entry.actor || null,
    entry.detail,
    entry.evidence ? JSON.stringify(entry.evidence) : null,
    entry.metadata ? JSON.stringify(entry.metadata) : "{}",
    timestamp,
    entry.correlationId || null,
  );

  return { ...entry, id, timestamp };
}

export function getTimeline(missionId: string, limit = 100): TimelineEntry[] {
  const db = getTimelineDb();
  const rows = db.prepare(
    "SELECT * FROM mission_timeline WHERE mission_id = ? ORDER BY timestamp ASC LIMIT ?"
  ).all(missionId, limit) as Record<string, unknown>[];

  return rows.map(rowToEntry);
}

export function getTimelineByType(missionId: string, type: string, limit = 50): TimelineEntry[] {
  const db = getTimelineDb();
  const rows = db.prepare(
    "SELECT * FROM mission_timeline WHERE mission_id = ? AND type = ? ORDER BY timestamp ASC LIMIT ?"
  ).all(missionId, type, limit) as Record<string, unknown>[];

  return rows.map(rowToEntry);
}

export function getRecentTimelineEvents(limit = 50): TimelineEntry[] {
  const db = getTimelineDb();
  const rows = db.prepare(
    "SELECT * FROM mission_timeline ORDER BY timestamp DESC LIMIT ?"
  ).all(limit) as Record<string, unknown>[];

  return rows.map(rowToEntry);
}

export function getTimelineCount(missionId: string): number {
  const db = getTimelineDb();
  return (db.prepare("SELECT COUNT(*) as c FROM mission_timeline WHERE mission_id = ?").get(missionId) as { c: number }).c;
}

export function cleanOldTimelines(olderThanDays = 30): number {
  const db = getTimelineDb();
  const cutoff = Date.now() - olderThanDays * 86400000;
  const result = db.prepare("DELETE FROM mission_timeline WHERE timestamp < ?").run(cutoff);
  return result.changes;
}

function rowToEntry(row: Record<string, unknown>): TimelineEntry {
  return {
    id: row.id as string,
    missionId: row.mission_id as string,
    type: row.type as TimelineEntry["type"],
    actor: row.actor as string | undefined,
    detail: row.detail as string,
    evidence: row.evidence ? JSON.parse(row.evidence as string) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    timestamp: row.timestamp as number,
    correlationId: row.correlation_id as string | undefined,
  };
}
