// @module mission-kernel/checkpoint v1.0.0 — Mission checkpoint system

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import type { MissionState } from "./state-machine";

let cpDb: Database.Database | null = null;

function getCheckpointDb(): Database.Database {
  if (cpDb) return cpDb;

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "mission-checkpoints.db");
  cpDb = new Database(dbPath);
  cpDb.pragma("journal_mode = WAL");
  cpDb.pragma("synchronous = NORMAL");
  cpDb.pragma("busy_timeout = 5000");

  cpDb.exec(`
    CREATE TABLE IF NOT EXISTS mission_checkpoints (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      state TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}',
      goals_json TEXT NOT NULL DEFAULT '[]',
      progress REAL NOT NULL DEFAULT 0,
      completed_tasks TEXT NOT NULL DEFAULT '[]',
      tool_calls_count INTEGER NOT NULL DEFAULT 0,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      cost_dollars REAL NOT NULL DEFAULT 0,
      memory_snapshot TEXT,
      workspace_snapshot TEXT,
      integrity_hash TEXT,
      can_rollback INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      restored_at INTEGER,
      restore_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_mcp_mission ON mission_checkpoints(mission_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_created ON mission_checkpoints(created_at);
  `);

  return cpDb;
}

export interface MissionCheckpoint {
  id: string;
  missionId: string;
  state: MissionState;
  context: Record<string, unknown>;
  goalsJson: string;
  progress: number;
  completedTasks: string[];
  toolCallsCount: number;
  tokensUsed: number;
  costDollars: number;
  memorySnapshot?: string;
  workspaceSnapshot?: string;
  integrityHash?: string;
  canRollback: boolean;
  createdAt: number;
  restoredAt?: number;
  restoreCount: number;
}

export interface CreateCheckpointInput {
  missionId: string;
  state: MissionState;
  context?: Record<string, unknown>;
  progress?: number;
  completedTasks?: string[];
  toolCallsCount?: number;
  tokensUsed?: number;
  costDollars?: number;
  memorySnapshot?: string;
  workspaceSnapshot?: string;
}

export function createCheckpoint(input: CreateCheckpointInput): MissionCheckpoint {
  const db = getCheckpointDb();
  const id = `cp-${randomUUID()}`;
  const now = Date.now();

  const goalsJson = JSON.stringify(input.context?.goals || []);
  const completedTasksJson = JSON.stringify(input.completedTasks || []);

  const integrityInput = `${input.missionId}:${input.state}:${now}:${input.progress}`;
  const integrityHash = simpleHash(integrityInput);

  db.prepare(`
    INSERT INTO mission_checkpoints (
      id, mission_id, state, context, goals_json, progress, completed_tasks,
      tool_calls_count, tokens_used, cost_dollars, memory_snapshot,
      workspace_snapshot, integrity_hash, can_rollback, created_at, restored_at, restore_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)
  `).run(
    id, input.missionId, input.state,
    JSON.stringify(input.context || {}),
    goalsJson,
    input.progress || 0,
    completedTasksJson,
    input.toolCallsCount || 0,
    input.tokensUsed || 0,
    input.costDollars || 0,
    input.memorySnapshot || null,
    input.workspaceSnapshot || null,
    integrityHash,
    1,
    now,
  );

  return loadCheckpoint(id)!;
}

export function loadCheckpoint(id: string): MissionCheckpoint | null {
  const db = getCheckpointDb();
  const row = db.prepare("SELECT * FROM mission_checkpoints WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToCheckpoint(row);
}

export function getLatestCheckpoint(missionId: string): MissionCheckpoint | null {
  const db = getCheckpointDb();
  const row = db.prepare(
    "SELECT * FROM mission_checkpoints WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(missionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToCheckpoint(row);
}

export function getCheckpoints(missionId: string, limit = 20): MissionCheckpoint[] {
  const db = getCheckpointDb();
  const rows = db.prepare(
    "SELECT * FROM mission_checkpoints WHERE mission_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(missionId, limit) as Record<string, unknown>[];
  return rows.map(rowToCheckpoint);
}

export function restoreCheckpoint(id: string): MissionCheckpoint | null {
  const db = getCheckpointDb();
  const checkpoint = loadCheckpoint(id);
  if (!checkpoint || !checkpoint.canRollback) return null;

  const now = Date.now();
  db.prepare(
    "UPDATE mission_checkpoints SET restored_at = ?, restore_count = restore_count + 1 WHERE id = ?"
  ).run(now, id);

  return loadCheckpoint(id);
}

export function verifyCheckpointIntegrity(id: string): { valid: boolean; actual: string; expected: string } {
  const cp = loadCheckpoint(id);
  if (!cp) return { valid: false, actual: "not found", expected: "" };

  if (!cp.integrityHash) return { valid: true, actual: "no hash", expected: "" };

  const integrityInput = `${cp.missionId}:${cp.state}:${cp.createdAt}:${cp.progress}`;
  const actual = simpleHash(integrityInput);

  return { valid: actual === cp.integrityHash, actual, expected: cp.integrityHash };
}

export function invalidateCheckpoint(id: string): void {
  const db = getCheckpointDb();
  db.prepare("UPDATE mission_checkpoints SET can_rollback = 0 WHERE id = ?").run(id);
}

export function cleanOldCheckpoints(olderThanDays = 30): number {
  const db = getCheckpointDb();
  const cutoff = Date.now() - olderThanDays * 86400000;
  const result = db.prepare(
    "DELETE FROM mission_checkpoints WHERE created_at < ? AND restore_count = 0"
  ).run(cutoff);
  return result.changes;
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(16);
}

function rowToCheckpoint(row: Record<string, unknown>): MissionCheckpoint {
  return {
    id: row.id as string,
    missionId: row.mission_id as string,
    state: row.state as MissionState,
    context: JSON.parse((row.context as string) || "{}"),
    goalsJson: (row.goals_json as string) || "[]",
    progress: row.progress as number,
    completedTasks: JSON.parse((row.completed_tasks as string) || "[]"),
    toolCallsCount: row.tool_calls_count as number,
    tokensUsed: row.tokens_used as number,
    costDollars: row.cost_dollars as number,
    memorySnapshot: row.memory_snapshot as string | undefined,
    workspaceSnapshot: row.workspace_snapshot as string | undefined,
    integrityHash: row.integrity_hash as string | undefined,
    canRollback: !!(row.can_rollback as number),
    createdAt: row.created_at as number,
    restoredAt: row.restored_at as number | undefined,
    restoreCount: row.restore_count as number,
  };
}
