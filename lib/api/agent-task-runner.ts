// ── Durable Agent Task Runner ──
// Executes agent tasks as background jobs, surviving timeouts and restarts.
// Separate from the chat request lifecycle. Frontend subscribes to updates.

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// ── Types ─────────────────────────────────────────────────────────────

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface TaskStep {
  index: number;
  tool: string;
  input: string;
  output: string;
  status: StepStatus;
  startedAt: number | null;
  completedAt: number | null;
}

export interface AgentTask {
  taskId: string;
  chatId: string;
  goal: string;
  status: TaskStatus;
  steps: TaskStep[];
  progress: string;
  totalSteps: number;
  completedSteps: number;
  createdAt: number;
  updatedAt: number;
  error: string | null;
}

// ── SQLite ────────────────────────────────────────────────────────────

const DB_PATH = path.join(process.cwd(), "data", "agent_tasks.db");
let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) { try { _db.pragma("quick_check"); return _db; } catch { _db = null; } }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS agent_tasks (
      task_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      goal TEXT DEFAULT '',
      status TEXT DEFAULT 'queued',
      steps_json TEXT DEFAULT '[]',
      progress TEXT DEFAULT '',
      total_steps INTEGER DEFAULT 0,
      completed_steps INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_task_chat ON agent_tasks(chat_id);
    CREATE INDEX IF NOT EXISTS idx_task_status ON agent_tasks(status);
  `);
  return _db;
}

// ── API ───────────────────────────────────────────────────────────────

export function createTask(chatId: string, goal: string): AgentTask {
  const db = getDb();
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(`INSERT INTO agent_tasks (task_id,chat_id,goal,status,steps_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`).run(taskId, chatId, goal, "queued", "[]", now, now);
  return {
    taskId, chatId, goal, status: "queued", steps: [],
    progress: "Task created", totalSteps: 0, completedSteps: 0,
    createdAt: now, updatedAt: now, error: null,
  };
}

export function getTask(taskId: string): AgentTask | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM agent_tasks WHERE task_id=?").get(taskId) as any;
  if (!row) return null;
  return rowToTask(row);
}

export function getTasksForChat(chatId: string): AgentTask[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM agent_tasks WHERE chat_id=? ORDER BY created_at DESC").all(chatId) as any[])
    .map(rowToTask);
}

export function getRunningTasksForChat(chatId: string): AgentTask[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM agent_tasks WHERE chat_id=? AND status IN ('queued','running') ORDER BY created_at DESC").all(chatId) as any[])
    .map(rowToTask);
}

export function updateTaskStatus(taskId: string, status: TaskStatus, error: string | null = null): void {
  const db = getDb();
  db.prepare("UPDATE agent_tasks SET status=?, error=?, updated_at=? WHERE task_id=?")
    .run(status, error, Date.now(), taskId);
}

export function updateTaskProgress(taskId: string, progress: string, completedSteps: number, totalSteps: number, lastTool?: string, lastOutput?: string): void {
  const db = getDb();
  db.prepare("UPDATE agent_tasks SET progress=?, completed_steps=?, total_steps=?, updated_at=? WHERE task_id=?")
    .run(progress, completedSteps, totalSteps, Date.now(), taskId);
  if (lastTool) {
    const task = getTask(taskId);
    if (task) {
      const steps = [...task.steps];
      if (steps.length > 0) {
        steps[steps.length - 1] = { ...steps[steps.length - 1], output: lastOutput || "", status: "completed", completedAt: Date.now() };
      }
      db.prepare("UPDATE agent_tasks SET steps_json=?, updated_at=? WHERE task_id=?")
        .run(JSON.stringify(steps), Date.now(), taskId);
    }
  }
}

export function addTaskStep(taskId: string, step: TaskStep): void {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) return;
  const steps = [...task.steps, step];
  db.prepare("UPDATE agent_tasks SET steps_json=?, updated_at=? WHERE task_id=?")
    .run(JSON.stringify(steps), Date.now(), taskId);
}

export function updateTaskStep(taskId: string, index: number, update: Partial<TaskStep>): void {
  const db = getDb();
  const task = getTask(taskId);
  if (!task || index >= task.steps.length) return;
  const steps = [...task.steps];
  steps[index] = { ...steps[index], ...update };
  db.prepare("UPDATE agent_tasks SET steps_json=?, updated_at=? WHERE task_id=?")
    .run(JSON.stringify(steps), Date.now(), taskId);
}

// ── Helpers ────────────────────────────────────────────────────────────

function rowToTask(row: any): AgentTask {
  return {
    taskId: row.task_id,
    chatId: row.chat_id,
    goal: row.goal,
    status: row.status,
    steps: JSON.parse(row.steps_json || "[]"),
    progress: row.progress || "",
    totalSteps: row.total_steps,
    completedSteps: row.completed_steps,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error || null,
  };
}
