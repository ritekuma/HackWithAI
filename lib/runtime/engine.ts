// ── Durable Enterprise Runtime with Crash Recovery ──
// SQLite-backed job queue, worker leases, checkpoint persistence,
// automatic crash recovery, distributed locking.
// Phase 4.2: Multi-worker coordination via SQLite.

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import { executeScheduled } from "@/lib/orchestration/real-orchestrator";
import type { AgentResult } from "@/lib/orchestration/real-orchestrator";
import { metrics, costTracker, tracer } from "@/lib/observability/engine";

// ── Types ─────────────────────────────────────────────────────────────

export type JobState =
  | "QUEUED" | "STARTING" | "RUNNING" | "WAITING"
  | "RETRYING" | "CANCELLED" | "FAILED" | "COMPLETED" | "TIMEOUT";

export interface DurableJob {
  id: string; task: string; tier: string; state: JobState;
  agents_json: string; results_json: string;
  tokens_in: number; tokens_out: number; tokens_total: number;
  duration_ms: number; attempts: number; retries: number;
  failures_json: string; timeline_json: string;
  created_at: number; completed_at: number | null;
  cost: number; worker_id: string | null;
  lease_until: number | null;
}

export interface RuntimeMetrics {
  queueDepth: number; runningJobs: number;
  totalCompleted: number; totalFailed: number;
  avgLatencyMs: number; avgTokens: number; avgCost: number; successRate: number;
}

// ── SQLite DB ─────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "runtime.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_jobs (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      tier TEXT DEFAULT 'QUEUED',
      state TEXT DEFAULT 'QUEUED',
      agents_json TEXT DEFAULT '[]',
      results_json TEXT DEFAULT '[]',
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      tokens_total INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      retries INTEGER DEFAULT 0,
      failures_json TEXT DEFAULT '[]',
      timeline_json TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      cost REAL DEFAULT 0,
      worker_id TEXT,
      lease_until INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_state ON runtime_jobs(state);
    CREATE INDEX IF NOT EXISTS idx_jobs_worker ON runtime_jobs(worker_id);

    CREATE TABLE IF NOT EXISTS runtime_workers (
      worker_id TEXT PRIMARY KEY,
      hostname TEXT,
      pid INTEGER,
      status TEXT DEFAULT 'active',
      current_job TEXT,
      started_at INTEGER NOT NULL,
      last_heartbeat INTEGER NOT NULL,
      is_leader INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_workers_status ON runtime_workers(status);
  `);
  return _db;
}

// ── Durable Queue ─────────────────────────────────────────────────────

function enqueueJob(job: DurableJob): void {
  const db = getDb();
  db.prepare(`INSERT INTO runtime_jobs (id,task,tier,state,agents_json,results_json,tokens_in,tokens_out,tokens_total,duration_ms,attempts,retries,failures_json,timeline_json,created_at,completed_at,cost,worker_id,lease_until)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    job.id, job.task, job.tier, job.state, job.agents_json, job.results_json,
    job.tokens_in, job.tokens_out, job.tokens_total, job.duration_ms,
    job.attempts, job.retries, job.failures_json, job.timeline_json,
    job.created_at, job.completed_at, job.cost, job.worker_id, job.lease_until,
  );
}

function dequeueJob(workerId: string): DurableJob | null {
  const db = getDb();
  const now = Date.now();
  // Find first QUEUED job or expired lease
  const row = db.prepare(
    `SELECT * FROM runtime_jobs WHERE state='QUEUED' OR (state='RUNNING' AND lease_until < ?) ORDER BY created_at LIMIT 1`
  ).get(now) as DurableJob | undefined;
  if (!row) return null;
  // Acquire lease
  const leaseUntil = now + 120_000; // 2 minute lease
  db.prepare(`UPDATE runtime_jobs SET state='RUNNING', worker_id=?, lease_until=? WHERE id=?`)
    .run(workerId, leaseUntil, row.id);
  return { ...row, state: "RUNNING", worker_id: workerId, lease_until: leaseUntil };
}

function updateJob(id: string, updates: Partial<DurableJob>): void {
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(updates)) {
    sets.push(`${k}=?`);
    vals.push(v);
  }
  vals.push(id);
  db.prepare(`UPDATE runtime_jobs SET ${sets.join(",")} WHERE id=?`).run(...vals);
}

function getJob(id: string): DurableJob | null {
  return (getDb().prepare("SELECT * FROM runtime_jobs WHERE id=?").get(id) as DurableJob) || null;
}

function getJobsByState(...states: string[]): DurableJob[] {
  const placeholders = states.map(() => "?").join(",");
  return getDb().prepare(`SELECT * FROM runtime_jobs WHERE state IN (${placeholders}) ORDER BY created_at`)
    .all(...states) as DurableJob[];
}

function getMetrics(): RuntimeMetrics & { activeWorkers: number; deadWorkers: number; isLeader: boolean } {
  const db = getDb();
  const completed = (db.prepare("SELECT COUNT(*) as c FROM runtime_jobs WHERE state='COMPLETED'").get() as any).c;
  const failed = (db.prepare("SELECT COUNT(*) as c FROM runtime_jobs WHERE state='FAILED'").get() as any).c;
  const running = (db.prepare("SELECT COUNT(*) as c FROM runtime_jobs WHERE state='RUNNING'").get() as any).c;
  const queued = (db.prepare("SELECT COUNT(*) as c FROM runtime_jobs WHERE state='QUEUED'").get() as any).c;
  const active = (db.prepare("SELECT COUNT(*) as c FROM runtime_workers WHERE status='active'").get() as any).c;
  const dead = (db.prepare("SELECT COUNT(*) as c FROM runtime_workers WHERE status='dead'").get() as any).c;
  const avgRow = db.prepare("SELECT AVG(duration_ms) as lat, AVG(tokens_total) as tok, AVG(cost) as cst FROM runtime_jobs WHERE state='COMPLETED'").get() as any;
  return {
    queueDepth: queued, runningJobs: running,
    totalCompleted: completed, totalFailed: failed,
    avgLatencyMs: Math.round(avgRow?.lat || 0),
    avgTokens: Math.round(avgRow?.tok || 0),
    avgCost: +(avgRow?.cst || 0).toFixed(4),
    successRate: completed + failed > 0 ? +(completed / (completed + failed) * 100).toFixed(1) : 100,
    activeWorkers: active, deadWorkers: dead, isLeader: _isLeader,
  };
}

// ── Crash Recovery ────────────────────────────────────────────────────

// ── Worker Registry & Leader Election ────────────────────────────────

let _workerId = `w-${os.hostname()}-${process.pid}-${Date.now().toString(36)}`;

export function getWorkerId(): string { return _workerId; }

function registerWorker(): void {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO runtime_workers (worker_id,hostname,pid,status,current_job,started_at,last_heartbeat,is_leader)
    VALUES (?,?,?,?,?,?,?,0)`).run(
    _workerId, os.hostname(), process.pid, "active", null, Date.now(), Date.now(),
  );
}

function updateHeartbeat(): void {
  const db = getDb();
  db.prepare("UPDATE runtime_workers SET last_heartbeat=?, status='active' WHERE worker_id=?")
    .run(Date.now(), _workerId);
}

function tryBecomeLeader(): boolean {
  const db = getDb();
  // Leader election: first worker to claim leadership when no active leader exists
  const activeLeaders = db.prepare(
    "SELECT worker_id FROM runtime_workers WHERE is_leader=1 AND status='active' AND last_heartbeat > ?"
  ).get(Date.now() - 90_000) as { worker_id: string } | undefined;

  if (activeLeaders) return activeLeaders.worker_id === _workerId;

  // No active leader — try to become one
  db.prepare("UPDATE runtime_workers SET is_leader=1 WHERE worker_id=? AND is_leader=0")
    .run(_workerId);
  const row = db.prepare("SELECT is_leader FROM runtime_workers WHERE worker_id=?").get(_workerId) as { is_leader: number };
  return row?.is_leader === 1;
}

function cleanupDeadWorkers(): void {
  const db = getDb();
  const deadline = Date.now() - 90_000;
  // Mark dead workers
  db.prepare("UPDATE runtime_workers SET status='dead' WHERE last_heartbeat < ? AND status='active'")
    .run(deadline);
  // Return dead workers' jobs to queue
  db.prepare(`UPDATE runtime_jobs SET state='QUEUED', worker_id=NULL, lease_until=NULL
    WHERE state='RUNNING' AND worker_id IN (SELECT worker_id FROM runtime_workers WHERE status='dead')`)
    .run();
}

let _isLeader = false;

export function recoverUnfinishedJobs(): number {
  const db = getDb();

  // Reset ALL RUNNING jobs to QUEUED on startup
  const running = db.prepare("SELECT id FROM runtime_jobs WHERE state='RUNNING'").all() as { id: string }[];
  for (const r of running) {
    db.prepare("UPDATE runtime_jobs SET state='QUEUED', worker_id=NULL, lease_until=NULL WHERE id=?").run(r.id);
  }

  db.prepare("UPDATE runtime_jobs SET state='QUEUED' WHERE state='STARTING' AND created_at < ?")
    .run(Date.now() - 300_000);

  console.error(`[runtime] worker=${_workerId} recovered ${running.length} orphaned jobs`);
  return running.length;
}

// ── Heartbeat ─────────────────────────────────────────────────────────

function startHeartbeat(): NodeJS.Timer {
  return setInterval(() => {
    const now = Date.now();
    updateHeartbeat();
    // Renew leases for jobs owned by this worker
    getDb().prepare(
      "UPDATE runtime_jobs SET lease_until=? WHERE worker_id=? AND state='RUNNING'"
    ).run(now + 120_000, _workerId);
    // Leader duties: cleanup dead workers
    if (_isLeader) {
      cleanupDeadWorkers();
    }
    // Re-attempt leader election
    _isLeader = tryBecomeLeader();
  }, 30_000);
}

// ── Durable Execution Manager ─────────────────────────────────────────

export class DurableExecutionManager {
  private timer: NodeJS.Timer | null = null;

  constructor() {
    registerWorker();
    _isLeader = tryBecomeLeader();
    console.error(`[runtime] worker=${_workerId} leader=${_isLeader}`);
    recoverUnfinishedJobs();
    this.timer = startHeartbeat();
    this.processLoop();
  }

  /** Submit a new job */
  submit(description: string): { jobId: string } {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: DurableJob = {
      id: jobId, task: description.substring(0, 500), tier: "QUEUED", state: "QUEUED",
      agents_json: "[]", results_json: "[]",
      tokens_in: 0, tokens_out: 0, tokens_total: 0,
      duration_ms: 0, attempts: 0, retries: 0,
      failures_json: "[]", timeline_json: JSON.stringify([{ agent: "system", event: "QUEUED", ts: Date.now() }]),
      created_at: Date.now(), completed_at: null, cost: 0,
      worker_id: null, lease_until: null,
    };
    enqueueJob(job);
    this.processLoop();
    return { jobId };
  }

  /** Get job status */
  status(jobId: string): any {
    const job = getJob(jobId);
    if (!job) return { error: "Not found" };
    return {
      id: job.id, task: job.task, tier: job.tier, state: job.state,
      agents: JSON.parse(job.agents_json),
      results: JSON.parse(job.results_json),
      totalTokens: { input: job.tokens_in, output: job.tokens_out, total: job.tokens_total },
      durationMs: job.duration_ms, attempts: job.attempts, retries: job.retries,
      failures: JSON.parse(job.failures_json),
      timeline: JSON.parse(job.timeline_json),
      createdAt: job.created_at, completedAt: job.completed_at, cost: job.cost,
    };
  }

  /** Cancel a job */
  cancel(jobId: string): { ok: boolean } {
    const job = getJob(jobId);
    if (!job) return { ok: false };
    if (["CANCELLED", "COMPLETED", "FAILED"].includes(job.state)) return { ok: false };

    const timeline = JSON.parse(job.timeline_json);
    timeline.push({ agent: "system", event: "CANCELLED", ts: Date.now() });
    updateJob(jobId, { state: "CANCELLED", completed_at: Date.now(), timeline_json: JSON.stringify(timeline) });
    return { ok: true };
  }

  /** Get metrics */
  getMetrics(): RuntimeMetrics { return getMetrics(); }

  /** Get history */
  getHistory(limit = 20): any[] {
    const jobs = getDb().prepare("SELECT * FROM runtime_jobs ORDER BY created_at DESC LIMIT ?").all(limit) as DurableJob[];
    return jobs.map(j => ({
      id: j.id, task: j.task.substring(0, 100), tier: j.tier, state: j.state,
      durationMs: j.duration_ms, tokensTotal: j.tokens_total,
      cost: j.cost, retries: j.retries,
    }));
  }

  /** Background job processor */
  private processing = false;
  private async processLoop() {
    if (this.processing) return;
    this.processing = true;

    while (true) {
      const job = dequeueJob(_workerId);
      if (!job) break;

      const t0 = Date.now();
      try {
        const timeline = JSON.parse(job.timeline_json);
        timeline.push({ agent: "system", event: "RUNNING", ts: Date.now() });
        updateJob(job.id, { timeline_json: JSON.stringify(timeline) });

        const result = await executeScheduled(job.task);
        const tier = (result as any).tier || "MEDIUM";
        const duration = Date.now() - t0;
        const cost = +(result.totalTokens.total / 1000 * 0.002).toFixed(6);

        // ── Observability: record metrics ──
        metrics.counter("hwai_jobs_total", "Total jobs completed", 1, { tier, state: "COMPLETED" });
        metrics.histogram("hwai_job_duration_ms", "Job duration in ms", duration, { tier });
        metrics.gauge("hwai_jobs_running", "Currently running jobs", 0);
        costTracker.record("model-standard-chat", "openrouter", result.totalTokens.total);

        updateJob(job.id, {
          state: "COMPLETED", tier,
          agents_json: JSON.stringify(result.results.map(r => r.agent)),
          results_json: JSON.stringify(result.results),
          tokens_in: result.totalTokens.input, tokens_out: result.totalTokens.output,
          tokens_total: result.totalTokens.total,
          duration_ms: duration, completed_at: Date.now(),
          cost, worker_id: null, lease_until: null,
          timeline_json: JSON.stringify([...timeline, { agent: "system", event: "COMPLETED", ts: Date.now() }]),
        });
      } catch (e: any) {
        const attempts = job.attempts + 1;
        const failures = JSON.parse(job.failures_json);
        failures.push(e.message || "Unknown");
        const timeline = JSON.parse(job.timeline_json);
        timeline.push({ agent: "system", event: `FAILED (attempt ${attempts})`, ts: Date.now() });

        if (attempts < 3) {
          updateJob(job.id, {
            state: "QUEUED", attempts, retries: job.retries + 1,
            failures_json: JSON.stringify(failures),
            timeline_json: JSON.stringify(timeline),
            worker_id: null, lease_until: null,
          });
          // Backoff before retry
          await new Promise(r => setTimeout(r, Math.min(2000 * Math.pow(2, attempts), 30000)));
        } else {
          updateJob(job.id, {
            state: "FAILED", attempts, completed_at: Date.now(),
            failures_json: JSON.stringify(failures),
            timeline_json: JSON.stringify(timeline),
            worker_id: null, lease_until: null,
          });
        }
      }
    }

    this.processing = false;
    // Check again after a delay
    setTimeout(() => { this.processing = false; this.processLoop(); }, 5000);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let _manager: DurableExecutionManager | null = null;

export function getExecutionManager(): DurableExecutionManager {
  if (!_manager) _manager = new DurableExecutionManager();
  return _manager;
}
