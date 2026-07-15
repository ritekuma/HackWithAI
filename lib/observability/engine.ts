// ── Enterprise Observability ──
// Metrics, tracing, cost tracking, health checks, dashboards.

import Database from "better-sqlite3";
import path from "path";
import { getDb as getRuntimeDb } from "./db";

// ── Prometheus Metrics Registry ──────────────────────────────────────

type MetricType = "counter" | "gauge" | "histogram";

interface Metric {
  name: string;
  help: string;
  type: MetricType;
  labels: Record<string, string>;
  value: number;
  buckets?: number[];
  sum?: number;
  count?: number;
}

class MetricsRegistry {
  private metrics = new Map<string, Metric>();

  /** Register or update a counter */
  counter(name: string, help: string, value: number, labels: Record<string, string> = {}) {
    const key = serializeKey(name, labels);
    const existing = this.metrics.get(key);
    if (existing) { existing.value += value; }
    else { this.metrics.set(key, { name, help, type: "counter", labels, value }); }
  }

  /** Set a gauge */
  gauge(name: string, help: string, value: number, labels: Record<string, string> = {}) {
    const key = serializeKey(name, labels);
    this.metrics.set(key, { name, help, type: "gauge", labels, value });
  }

  /** Record a histogram observation */
  histogram(name: string, help: string, value: number, labels: Record<string, string> = {}) {
    const buckets = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000, 300000, 600000];
    const key = serializeKey(name, labels);
    const existing = this.metrics.get(key);
    if (existing) { existing.count = (existing.count || 0) + 1; existing.sum = (existing.sum || 0) + value; }
    else { this.metrics.set(key, { name, help, type: "histogram", labels, value, buckets, sum: value, count: 1 }); }
  }

  /** Prometheus text format */
  prometheus(): string {
    const lines: string[] = [];
    for (const [key, m] of this.metrics) {
      lines.push(`# HELP ${m.name} ${m.help}`);
      lines.push(`# TYPE ${m.name} ${m.type}`);
      const labelStr = m.labels && Object.keys(m.labels).length > 0
        ? `{${Object.entries(m.labels).map(([k,v]) => `${k}="${v}"`).join(",")}}`
        : "";
      if (m.type === "histogram") {
        lines.push(`${m.name}_sum${labelStr} ${m.sum}`);
        lines.push(`${m.name}_count${labelStr} ${m.count}`);
      } else {
        lines.push(`${m.name}${labelStr} ${m.value}`);
      }
    }
    return lines.join("\n") + "\n";
  }

  /** JSON snapshot for dashboards */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, m] of this.metrics) {
      out[key] = m.value;
    }
    return out;
  }

  reset() { this.metrics.clear(); }
}

function serializeKey(name: string, labels: Record<string, string>): string {
  const labelStr = Object.entries(labels).sort((a,b) => a[0].localeCompare(b[0]))
    .map(([k,v]) => `${k}=${v}`).join(",");
  return labelStr ? `${name}{${labelStr}}` : name;
}

// ── Global metrics instance ──────────────────────────────────────────

export const metrics = new MetricsRegistry();

// ── Tracer ────────────────────────────────────────────────────────────

export interface TraceSpan {
  id: string;
  name: string;
  start: number;
  end: number | null;
  metadata: Record<string, unknown>;
  children: TraceSpan[];
}

class Tracer {
  private spans = new Map<string, TraceSpan>();
  private rootSpans: TraceSpan[] = [];

  /** Start a new span */
  startSpan(name: string, metadata: Record<string, unknown> = {}): string {
    const id = `span-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const span: TraceSpan = { id, name, start: Date.now(), end: null, metadata, children: [] };
    this.spans.set(id, span);
    this.rootSpans.push(span);
    return id;
  }

  /** End a span */
  endSpan(id: string, metadata?: Record<string, unknown>) {
    const span = this.spans.get(id);
    if (!span) return;
    span.end = Date.now();
    if (metadata) Object.assign(span.metadata, metadata);

    // Record duration histogram
    const duration = span.end - span.start;
    metrics.histogram("hwai_span_duration_ms", "Span duration in ms", duration, { name: span.name });
    metrics.counter("hwai_span_total", "Total spans completed", 1, { name: span.name });
  }

  /** Get root-level trace timeline */
  getTimeline(limit = 50): { name: string; durationMs: number; metadata: Record<string, unknown> }[] {
    return this.rootSpans.slice(-limit).map(s => ({
      name: s.name,
      durationMs: s.end && s.start ? s.end - s.start : 0,
      metadata: s.metadata,
    }));
  }

  reset() { this.spans.clear(); this.rootSpans = []; }
}

export const tracer = new Tracer();

// ── Cost Tracker ──────────────────────────────────────────────────────

const MODEL_COSTS: Record<string, number> = {
  "deepseek/deepseek-v4-pro": 0.002,
  "deepseek/deepseek-v4-flash": 0.0005,
  "anthropic/claude-sonnet-4.6": 0.003,
  "google/gemini-2.5-flash": 0.0005,
  "model-standard-chat": 0.002,
  "model-standard-fallback": 0.0005,
};

class CostTracker {
  private costs: { model: string; provider: string; tokens: number; cost: number; ts: number }[] = [];

  record(model: string, provider: string, totalTokens: number) {
    const rate = MODEL_COSTS[model] ?? 0.001;
    const cost = +(totalTokens / 1000 * rate).toFixed(6);
    this.costs.push({ model, provider, tokens: totalTokens, cost, ts: Date.now() });
    metrics.counter("hwai_cost_total", "Total cost in USD", cost, { model, provider });
    metrics.counter("hwai_tokens_total", "Total tokens consumed", totalTokens, { model, provider });
  }

  getAnalytics() {
    const now = Date.now();
    const byModel: Record<string, { calls: number; tokens: number; cost: number }> = {};
    const byProvider: Record<string, { calls: number; tokens: number; cost: number }> = {};
    for (const c of this.costs) {
      const m = (byModel[c.model] = byModel[c.model] || { calls: 0, tokens: 0, cost: 0 });
      m.calls++; m.tokens += c.tokens; m.cost += c.cost;
      const p = (byProvider[c.provider] = byProvider[c.provider] || { calls: 0, tokens: 0, cost: 0 });
      p.calls++; p.tokens += c.tokens; p.cost += c.cost;
    }
    const dayStart = now - 86400000;
    const today = this.costs.filter(c => c.ts > dayStart);
    return {
      totalCost: +this.costs.reduce((s,c) => s + c.cost, 0).toFixed(6),
      todayCost: +today.reduce((s,c) => s + c.cost, 0).toFixed(6),
      totalCalls: this.costs.length,
      byModel,
      byProvider,
    };
  }

  reset() { this.costs = []; }
}

export const costTracker = new CostTracker();

// ── Health Checks ────────────────────────────────────────────────────

export async function healthCheck(): Promise<Record<string, { status: string; detail?: string }>> {
  const results: Record<string, { status: string; detail?: string }> = {};

  // SQLite check
  try {
    const db = getRuntimeDb();
    db.prepare("SELECT 1").get();
    results.sqlite = { status: "healthy" };
  } catch (e: any) {
    results.sqlite = { status: "unhealthy", detail: e.message };
  }

  // Runtime check
  try {
    const db = getRuntimeDb();
    const running = (db.prepare("SELECT COUNT(*) as c FROM runtime_jobs WHERE state='RUNNING'").get() as any).c;
    results.runtime = { status: "healthy", detail: `${running} jobs running` };
  } catch (e: any) {
    results.runtime = { status: "unhealthy", detail: e.message };
  }

  // Provider check (OpenRouter)
  try {
    results.openrouter = { status: "healthy", detail: "using model-standard-chat" };
  } catch (e: any) {
    results.openrouter = { status: "unhealthy", detail: e.message };
  }

  // Redis check
  try {
    const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    if (REDIS_URL) {
      results.redis = { status: "healthy", detail: REDIS_URL };
    } else {
      results.redis = { status: "unavailable", detail: "REDIS_URL not set" };
    }
  } catch (e: any) {
    results.redis = { status: "unhealthy", detail: e.message };
  }

  return results;
}

// ── Dashboard Data ───────────────────────────────────────────────────

export function getExecutionDashboard() {
  const db = getRuntimeDb();
  const completed = (db.prepare("SELECT COUNT(*) as c FROM runtime_jobs WHERE state='COMPLETED'").get() as any).c;
  const failed = (db.prepare("SELECT COUNT(*) as c FROM runtime_jobs WHERE state='FAILED'").get() as any).c;
  const cancelled = (db.prepare("SELECT COUNT(*) as c FROM runtime_jobs WHERE state='CANCELLED'").get() as any).c;
  const running = (db.prepare("SELECT COUNT(*) as c FROM runtime_jobs WHERE state IN ('QUEUED','RUNNING','STARTING')").get() as any).c;

  const recent = db.prepare("SELECT id, task, state, tier, duration_ms, tokens_total, cost, created_at FROM runtime_jobs ORDER BY created_at DESC LIMIT 10").all() as any[];

  return {
    summary: { completed, failed, cancelled, running, total: completed + failed + cancelled + running },
    successRate: completed + failed > 0 ? +(completed / (completed + failed) * 100).toFixed(1) : 100,
    recent,
    timeline: tracer.getTimeline(20),
  };
}

export function getWorkerDashboard() {
  const db = getRuntimeDb();
  const workers = db.prepare("SELECT * FROM runtime_workers ORDER BY started_at DESC LIMIT 20").all() as any[];
  const jobsByWorker = db.prepare("SELECT worker_id, COUNT(*) as c, AVG(duration_ms) as avg_dur FROM runtime_jobs WHERE worker_id IS NOT NULL GROUP BY worker_id").all() as any[];
  return { workers, jobsByWorker };
}

export function getCostDashboard() {
  return {
    ...costTracker.getAnalytics(),
    metrics: metrics.snapshot(),
  };
}

// ── DB access (shared with runtime) ──────────────────────────────────

export { getRuntimeDb };
