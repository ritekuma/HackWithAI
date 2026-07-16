// ── Persistent Project Memory ──
// Stores project state independently of chat context.
// Survives browser refresh, server restart, crash, power loss.
// Never compressed, never deleted. Only the LLM prompt is compressed.

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// ── Types ─────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "active" | "completed" | "failed" | "cancelled";
export type GoalStatus = "active" | "achieved" | "abandoned";
export type BugStatus = "open" | "in_progress" | "fixed" | "wont_fix";

export interface ProjectTask {
  id: string; title: string; description: string;
  status: TaskStatus; priority: number;
  createdAt: number; updatedAt: number; completedAt: number | null;
  parentId: string | null;
}

export interface ProjectDecision {
  id: string; title: string; context: string; decision: string;
  createdAt: number;
}

export interface ProjectGoal {
  id: string; goal: string; status: GoalStatus;
  createdAt: number; updatedAt: number;
}

export interface ProjectBug {
  id: string; title: string; description: string;
  status: BugStatus; fixDescription: string;
  createdAt: number; fixedAt: number | null;
}

export interface ArchitectureComponent {
  id: string; component: string; description: string;
  dependsOn: string; createdAt: number;
}

export interface ProjectConfig {
  id: string; key: string; value: string;
  category: string; createdAt: number;
}

export interface ProjectState {
  tasks: ProjectTask[];
  decisions: ProjectDecision[];
  goals: ProjectGoal[];
  bugs: ProjectBug[];
  architecture: ArchitectureComponent[];
  config: ProjectConfig[];
  updatedAt: number;
}

export interface RecoveryInfo {
  hasUnfinishedWork: boolean;
  activeTask: ProjectTask | null;
  pendingTasks: number;
  completedTasks: number;
  totalTasks: number;
  completionPct: number;
  activeGoal: ProjectGoal | null;
  openBugs: number;
  lastUpdated: number;
  summary: string;
}

// ── SQLite ────────────────────────────────────────────────────────────

const DB_PATH = path.join(process.cwd(), "data", "project_memory.db");
let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) { try { _db.pragma("quick_check"); return _db; } catch { _db = null; } }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', priority INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      completed_at INTEGER, parent_id TEXT
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, context TEXT DEFAULT '',
      decision TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY, goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bugs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open', fix_description TEXT DEFAULT '',
      created_at INTEGER NOT NULL, fixed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS architecture (
      id TEXT PRIMARY KEY, component TEXT NOT NULL, description TEXT DEFAULT '',
      depends_on TEXT DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_config (
      id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL,
      category TEXT DEFAULT 'general', created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
    CREATE INDEX IF NOT EXISTS idx_bugs_status ON bugs(status);
  `);
  return _db;
}

function uid(): string { return `p${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

// ── Tasks ─────────────────────────────────────────────────────────────

export function createTask(title: string, description = "", priority = 1, parentId: string | null = null): ProjectTask {
  const db = getDb();
  const id = uid();
  const now = Date.now();
  db.prepare("INSERT INTO tasks (id,title,description,status,priority,created_at,updated_at,parent_id) VALUES(?,?,?,?,?,?,?,?)")
    .run(id, title, description, "pending", priority, now, now, parentId);
  return { id, title, description, status: "pending", priority, createdAt: now, updatedAt: now, completedAt: null, parentId };
}

export function updateTaskStatus(id: string, status: TaskStatus): boolean {
  const db = getDb();
  const now = Date.now();
  const completedAt = status === "completed" ? now : null;
  const r = db.prepare("UPDATE tasks SET status=?, updated_at=?, completed_at=? WHERE id=?")
    .run(status, now, completedAt, id);
  return r.changes > 0;
}

export function getTasks(status?: TaskStatus): ProjectTask[] {
  const db = getDb();
  const sql = status
    ? "SELECT * FROM tasks WHERE status=? ORDER BY priority DESC, created_at ASC"
    : "SELECT * FROM tasks ORDER BY status, priority DESC, created_at ASC";
  const rows = status ? db.prepare(sql).all(status) : db.prepare(sql).all();
  return (rows as any[]).map(r => rowToTask(r));
}

function rowToTask(r: any): ProjectTask {
  return { id: r.id, title: r.title, description: r.description, status: r.status, priority: r.priority, createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at, parentId: r.parent_id };
}

// ── Decisions ─────────────────────────────────────────────────────────

export function recordDecision(title: string, context: string, decision: string): ProjectDecision {
  const db = getDb();
  const id = uid();
  const now = Date.now();
  db.prepare("INSERT INTO decisions (id,title,context,decision,created_at) VALUES(?,?,?,?,?)")
    .run(id, title, context, decision, now);
  return { id, title, context, decision, createdAt: now };
}

export function getDecisions(): ProjectDecision[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM decisions ORDER BY created_at DESC LIMIT 50").all() as any[])
    .map(r => ({ id: r.id, title: r.title, context: r.context, decision: r.decision, createdAt: r.created_at }));
}

// ── Goals ─────────────────────────────────────────────────────────────

export function setGoal(goal: string, status: GoalStatus = "active"): ProjectGoal {
  const db = getDb();
  const id = uid();
  const now = Date.now();
  db.prepare("INSERT INTO goals (id,goal,status,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run(id, goal, status, now, now);
  return { id, goal, status, createdAt: now, updatedAt: now };
}

export function getActiveGoals(): ProjectGoal[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM goals WHERE status='active' ORDER BY created_at DESC").all() as any[])
    .map(r => ({ id: r.id, goal: r.goal, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at }));
}

// ── Bugs ──────────────────────────────────────────────────────────────

export function recordBug(title: string, description = ""): ProjectBug {
  const db = getDb();
  const id = uid();
  const now = Date.now();
  db.prepare("INSERT INTO bugs (id,title,description,status,created_at) VALUES(?,?,?,?,?)")
    .run(id, title, description, "open", now);
  return { id, title, description, status: "open", fixDescription: "", createdAt: now, fixedAt: null };
}

export function fixBug(id: string, fixDescription = ""): boolean {
  const db = getDb();
  const r = db.prepare("UPDATE bugs SET status='fixed', fix_description=?, fixed_at=? WHERE id=?")
    .run(fixDescription, Date.now(), id);
  return r.changes > 0;
}

export function getOpenBugs(): ProjectBug[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM bugs WHERE status IN ('open','in_progress') ORDER BY created_at DESC").all() as any[])
    .map(r => ({ id: r.id, title: r.title, description: r.description, status: r.status, fixDescription: r.fix_description, createdAt: r.created_at, fixedAt: r.fixed_at }));
}

// ── Architecture ──────────────────────────────────────────────────────

export function recordArchitecture(component: string, description: string, dependsOn = ""): ArchitectureComponent {
  const db = getDb();
  const id = uid();
  const now = Date.now();
  db.prepare("INSERT INTO architecture (id,component,description,depends_on,created_at) VALUES(?,?,?,?,?)")
    .run(id, component, description, dependsOn, now);
  return { id, component, description, dependsOn, createdAt: now };
}

export function getArchitecture(): ArchitectureComponent[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM architecture ORDER BY created_at ASC").all() as any[])
    .map(r => ({ id: r.id, component: r.component, description: r.description, dependsOn: r.depends_on, createdAt: r.created_at }));
}

// ── Config ────────────────────────────────────────────────────────────

export function setConfig(key: string, value: string, category = "general"): ProjectConfig {
  const db = getDb();
  const now = Date.now();
  db.prepare("INSERT OR REPLACE INTO project_config (id,key,value,category,created_at) VALUES(?,?,?,?,?)")
    .run(uid(), key, value, category, now);
  return { id: uid(), key, value, category, createdAt: now };
}

export function getConfig(): ProjectConfig[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM project_config ORDER BY category, key").all() as any[])
    .map(r => ({ id: r.id, key: r.key, value: r.value, category: r.category, createdAt: r.created_at }));
}

// ── Full State ────────────────────────────────────────────────────────

export function getProjectState(): ProjectState {
  return {
    tasks: getTasks(),
    decisions: getDecisions(),
    goals: getActiveGoals(),
    bugs: getOpenBugs(),
    architecture: getArchitecture(),
    config: getConfig(),
    updatedAt: Date.now(),
  };
}

// ── Recovery Info ─────────────────────────────────────────────────────

export function getRecoveryInfo(): RecoveryInfo {
  const tasks = getTasks();
  const activeTask = tasks.find(t => t.status === "active") || null;
  const pendingTasks = tasks.filter(t => t.status === "pending");
  const completedTasks = tasks.filter(t => t.status === "completed");
  const totalTasks = tasks.length;
  const completionPct = totalTasks > 0 ? Math.round((completedTasks.length / totalTasks) * 100) : 0;
  const activeGoal = getActiveGoals()[0] || null;
  const openBugs = getOpenBugs().length;
  const hasUnfinishedWork = activeTask !== null || pendingTasks.length > 0 || activeGoal !== null;

  // Build a compact summary for the model
  const parts: string[] = [];
  if (activeTask) parts.push(`Active task: "${activeTask.title}"`);
  if (pendingTasks.length > 0) parts.push(`Pending: ${pendingTasks.map(t => t.title).join(", ")}`);
  if (completedTasks.length > 0) parts.push(`Completed: ${completedTasks.length}/${totalTasks} tasks`);
  if (activeGoal) parts.push(`Goal: ${activeGoal.goal}`);
  if (openBugs > 0) parts.push(`Open bugs: ${openBugs}`);

  return {
    hasUnfinishedWork,
    activeTask,
    pendingTasks: pendingTasks.length,
    completedTasks: completedTasks.length,
    totalTasks,
    completionPct,
    activeGoal,
    openBugs,
    lastUpdated: Date.now(),
    summary: parts.length > 0 ? parts.join(" | ") : "No active tasks",
  };
}

// ── Context Injection ─────────────────────────────────────────────────

/** Returns a compact project context block for LLM prompts */
export function getProjectContext(): string {
  const state = getProjectState();
  const lines: string[] = ["=== PROJECT MEMORY ==="];

  if (state.tasks.length > 0) {
    lines.push("[Tasks]");
    for (const t of state.tasks) {
      const icon = t.status === "completed" ? "✓" : t.status === "active" ? "▶" : t.status === "failed" ? "✗" : "○";
      lines.push(`  ${icon} [${t.status}] ${t.title}`);
    }
  }

  if (state.goals.length > 0) {
    lines.push("[Goals]");
    for (const g of state.goals) lines.push(`  - ${g.goal}`);
  }

  if (state.bugs.length > 0) {
    lines.push(`[Bugs] ${state.bugs.length} open:`);
    for (const b of state.bugs) lines.push(`  - ${b.title}`);
  }

  if (state.decisions.length > 0) {
    lines.push("[Key Decisions]");
    for (const d of state.decisions.slice(0, 5)) lines.push(`  - ${d.title}: ${d.decision.substring(0, 80)}`);
  }

  if (state.architecture.length > 0) {
    lines.push("[Architecture]");
    for (const a of state.architecture) {
      const deps = a.dependsOn ? ` (depends on: ${a.dependsOn})` : "";
      lines.push(`  - ${a.component}: ${a.description.substring(0, 60)}${deps}`);
    }
  }

  lines.push("=== END PROJECT MEMORY ===");
  return lines.join("\n");
}
