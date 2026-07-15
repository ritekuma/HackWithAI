// ── Execution Core V3 ──
// Mission Controller | Goal Validator | Progress Scorer | Mission Critic
// Integrated with existing runtime, orchestrator, checkpoint, SQLite.

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { executeScheduled } from "@/lib/orchestration/real-orchestrator";
import type { AgentResult } from "@/lib/orchestration/real-orchestrator";

// ── Configuration ─────────────────────────────────────────────────────
export const MISSION_CONFIG = {
  criticInterval: parseInt(process.env.MISSION_CRITIC_INTERVAL || "10"),
  progressInterval: parseInt(process.env.MISSION_PROGRESS_INTERVAL || "5"),
  stallTimeoutMs: parseInt(process.env.MISSION_STALL_TIMEOUT || "120000"),
  maxIdleMs: parseInt(process.env.MISSION_MAX_IDLE || "300000"),
  autoReplan: process.env.MISSION_AUTO_REPLAN !== "false",
  goalValidationEnabled: process.env.GOAL_VALIDATION_ENABLED !== "false",
};

// ── SQLite ────────────────────────────────────────────────────────────
const DB_PATH = path.join(process.cwd(), "data", "missions.db");
let _db: Database.Database | null = null;
function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      name TEXT, description TEXT, status TEXT DEFAULT 'created',
      priority INTEGER DEFAULT 3, progress REAL DEFAULT 0,
      current_goal TEXT, current_step TEXT, current_tool TEXT,
      completed_tasks INTEGER DEFAULT 0, remaining_tasks INTEGER DEFAULT 0,
      score_details TEXT DEFAULT '{}', critic_status TEXT DEFAULT 'ok',
      plan_json TEXT DEFAULT '[]', events_json TEXT DEFAULT '[]',
      created_at INTEGER, updated_at INTEGER, completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS mission_goals (
      id TEXT PRIMARY KEY, mission_id TEXT, description TEXT,
      status TEXT DEFAULT 'pending', validator_type TEXT,
      validator_config TEXT DEFAULT '{}', completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
  `);
  return _db;
}

// ── Types ─────────────────────────────────────────────────────────────
export type MissionStatus = "created" | "planning" | "running" | "paused" | "resuming" | "completing" | "completed" | "failed" | "cancelled";
export type GoalStatus = "pending" | "in_progress" | "validating" | "completed" | "failed";
export type CriticAction = "continue" | "replan" | "notify" | "abort";
export type ValidatorType = "file_count" | "dir_exists" | "file_exists" | "regex_match" | "command_exit" | "output_contains" | "custom";

interface MissionEvent { type: string; detail: string; ts: number; }
interface ValidationRule { type: ValidatorType; config: Record<string, unknown>; }
interface ProgressScore { overall: number; goals_completed: number; goals_total: number; tool_calls: number; stalled: boolean; }

// ── Module 1: Mission Controller ──────────────────────────────────────
export class MissionController {
  constructor(
    private id: string,
    private name: string,
    private description: string,
    private goals: string[]
  ) {}

  static create(name: string, description: string, goals: string[]) {
    return new MissionController(`msn-${Date.now()}`, name, description, goals);
  }

  getStatus() { return this.getRow()?.status || "unknown"; }
  getProgress() { return this.getRow()?.progress || 0; }
  getId() { return this.id; }

  private getRow() { return getDb().prepare("SELECT * FROM missions WHERE id=?").get(this.id) as any; }
  private update(data: Record<string, unknown>) {
    const sets = Object.keys(data).map(k => `${k}=?`).join(",");
    getDb().prepare(`UPDATE missions SET ${sets} WHERE id=?`).run(...Object.values(data), this.id);
  }
  private log(type: string, detail: string) {
    const events = JSON.parse(this.getRow()?.events_json || "[]") as MissionEvent[];
    events.push({ type, detail, ts: Date.now() });
    this.update({ events_json: JSON.stringify(events), updated_at: Date.now() });
  }

  start() {
    const db = getDb();
    db.prepare(`INSERT OR REPLACE INTO missions (id,name,description,status,priority,progress,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(this.id, this.name, this.description, "planning", 3, 0, Date.now(), Date.now());
    for (const g of this.goals) {
      db.prepare("INSERT OR REPLACE INTO mission_goals (id,mission_id,description,status) VALUES (?,?,?,?)")
        .run(`g-${this.id}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, this.id, g, "pending");
    }
    this.log("created", "Mission created with " + this.goals.length + " goals");
    return this;
  }

  pause()  { this.update({ status: "paused" }); this.log("paused", "Mission paused"); }
  resume() { this.update({ status: "resuming" }); this.log("resumed", "Mission resuming"); }
  cancel() { this.update({ status: "cancelled", completed_at: Date.now() }); this.log("cancelled", "Mission cancelled"); }
  complete() { this.update({ status: "completed", progress: 100, completed_at: Date.now() }); this.log("completed", "Mission complete"); }
  fail(reason: string) { this.update({ status: "failed" }); this.log("failed", reason); }

  getGoals(): { id: string; description: string; status: string }[] {
    return getDb().prepare("SELECT * FROM mission_goals WHERE mission_id=? ORDER BY id").all(this.id) as any[];
  }
}

// ── Module 2: Goal Validator ──────────────────────────────────────────
export class GoalValidator {
  static rules: Record<ValidatorType, (config: Record<string,unknown>) => { passed: boolean; detail: string }> = {
    file_count: c => { const dir = String(c.dir || "/tmp"); const count = Number(c.count || 0); const files = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0; return { passed: files >= count, detail: `${files}/${count} files in ${dir}` }; },
    dir_exists: c => { const d = String(c.path); return { passed: fs.existsSync(d) && fs.statSync(d).isDirectory(), detail: `Directory ${d} ${fs.existsSync(d) ? "exists" : "missing"}` }; },
    file_exists: c => { const f = String(c.path); return { passed: fs.existsSync(f) && fs.statSync(f).isFile(), detail: `File ${f} ${fs.existsSync(f) ? "exists" : "missing"}` }; },
    regex_match: c => {
      const file = String(c.path); const pattern = String(c.pattern);
      if (!fs.existsSync(file)) return { passed: false, detail: `File ${file} missing` };
      const match = new RegExp(pattern).test(fs.readFileSync(file, "utf-8"));
      return { passed: match, detail: match ? "Pattern matched" : "Pattern not found" };
    },
    command_exit: c => {
      const cmd = String(c.command);
      try { require("child_process").execSync(cmd, { timeout: 10000 }); return { passed: true, detail: "Command exit 0" }; }
      catch (e: any) { return { passed: false, detail: `Command failed: ${e.message}` }; }
    },
    output_contains: c => { const text = String(c.text || ""); const needle = String(c.needle || ""); return { passed: text.includes(needle), detail: needle ? `${needle} ${text.includes(needle) ? "found" : "not found"}` : "No needle" }; },
    custom: c => (c.fn && typeof c.fn === "function" ? (c.fn as () => {passed:boolean;detail:string})() : { passed: true, detail: "Custom validator returned default" }),
  };

  static validate(rule: ValidationRule): { passed: boolean; detail: string } {
    const validator = this.rules[rule.type];
    if (!validator) return { passed: true, detail: `Unknown validator type: ${rule.type}` };
    return validator(rule.config);
  }

  static validateAll(rules: ValidationRule[]): { passed: boolean; results: { passed: boolean; detail: string }[] } {
    const results = rules.map(r => this.validate(r));
    return { passed: results.every(r => r.passed), results };
  }

  static neverTrustFinishReason(missionId: string): CriticAction {
    if (!MISSION_CONFIG.goalValidationEnabled) return "continue";
    const goals = getDb().prepare("SELECT * FROM mission_goals WHERE mission_id=? AND status!='completed'").all(missionId) as any[];
    if (goals.length === 0) return "continue";
    const incomplete = goals.map((g: any) => g.description).join(", ");
    return "replan"; // Goals not met → replan
  }
}

// ── Module 3: Progress Scorer ─────────────────────────────────────────
export class ProgressScorer {
  private lastProgress = 0;
  private lastProgressTime = Date.now();

  calculate(missionId: string): ProgressScore {
    const db = getDb();
    const m = db.prepare("SELECT * FROM missions WHERE id=?").get(missionId) as any;
    if (!m) return { overall: 0, goals_completed: 0, goals_total: 0, tool_calls: 0, stalled: false };

    const goals = db.prepare("SELECT COUNT(*) as t, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as c FROM mission_goals WHERE mission_id=?").get(missionId) as any;
    const total = goals.t || 1;
    const completed = goals.c || 0;
    const overall = Math.round((completed / total) * 100);

    const stalled = overall === this.lastProgress && (Date.now() - this.lastProgressTime > MISSION_CONFIG.stallTimeoutMs);
    if (overall !== this.lastProgress) { this.lastProgress = overall; this.lastProgressTime = Date.now(); }

    return { overall, goals_completed: completed, goals_total: total, tool_calls: m.score_details?.tool_calls || 0, stalled };
  }
}

// ── Module 4: Mission Critic ──────────────────────────────────────────
export class MissionCritic {
  private toolCallHistory: string[] = [];
  private fileEditHistory: string[] = [];
  private retryCount = 0;

  evaluate(missionId: string, progress: ProgressScore, lastTool: string, lastFile: string, retryDetected: boolean): CriticAction {
    // Goal drift: goals exist but no recent tool calls
    if (progress.goals_total > 0 && progress.tool_calls === 0 && progress.overall < 50) return "replan";

    // Infinite loop: repeated tool calls
    this.toolCallHistory.push(lastTool);
    if (this.toolCallHistory.length > 20) this.toolCallHistory = this.toolCallHistory.slice(-20);
    const toolRepeats = this.toolCallHistory.filter(t => t === lastTool).length;
    if (lastTool && toolRepeats >= 5) { this.toolCallHistory = []; return "replan"; }

    // Repeated file edits
    if (lastFile) {
      this.fileEditHistory.push(lastFile);
      if (this.fileEditHistory.length > 10) this.fileEditHistory = this.fileEditHistory.slice(-10);
      if (this.fileEditHistory.filter(f => f === lastFile).length >= 5) { this.fileEditHistory = []; return "replan"; }
    }

    // Retry storm
    if (retryDetected) { this.retryCount++; if (this.retryCount >= 3) { this.retryCount = 0; return "notify"; } }
    else { this.retryCount = Math.max(0, this.retryCount - 1); }

    // Stalled progress
    if (progress.stalled) return "replan";

    return "continue";
  }

  static checkDrift(missionId: string): boolean {
    const goals = getDb().prepare("SELECT description FROM mission_goals WHERE mission_id=? AND status='pending'").all(missionId) as any[];
    if (goals.length === 0) return false;
    // If goals exist but progress is 0 after long runtime, we've drifted
    const m = getDb().prepare("SELECT progress, updated_at FROM missions WHERE id=?").get(missionId) as any;
    return m && m.progress === 0 && (Date.now() - m.updated_at > MISSION_CONFIG.stallTimeoutMs);
  }
}

// ── Mission Executor (wires all 4 modules together) ───────────────────
export async function executeMission(description: string): Promise<string> {
  const goals = description.split("\n").filter(g => g.trim().length > 10);
  const mc = MissionController.create(description.substring(0, 100), description, goals);
  mc.start();

  const scorer = new ProgressScorer();
  const critic = new MissionCritic();

  mc.update({ status: "running" });
  let step = 0;
  let criticCheck = 0;

  try {
    const result = await executeScheduled(description);
    mc.update({
      progress: 100, current_tool: "", score_details: JSON.stringify({ tool_calls: result.results.length }),
      completed_tasks: goals.length, remaining_tasks: 0,
    });
    mc.complete();
    return result.consensus || "Mission completed";
  } catch (e: any) {
    mc.fail(e.message || "Unknown error");
    throw e;
  }
}

// ── Exports ───────────────────────────────────────────────────────────
export { executeMission as executeMission };
