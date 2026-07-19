// @module events/observability v1.0.0 — Event Bus metrics, tracing, and observability

import type { Event, EventBusMetrics, Subscription } from "./types";

interface LatencyEntry {
  timestamp: number;
  latencyMs: number;
}

interface SubscriberTiming {
  subscriberId: string;
  avgTimeMs: number;
  totalDeliveries: number;
  totalTimeMs: number;
}

const latencyWindow: LatencyEntry[] = [];
const MAX_LATENCY_WINDOW = 10000;

const subscriberTimings = new Map<string, SubscriberTiming>();

// Counters for metrics that aren't in SQLite
let activeSubscriberCount = 0;
let queueDepthSnapshot = 0;

export function recordEventPublished(event: Event): void {
  queueDepthSnapshot++;
}

export function recordEventDelivered(event: Event, subscriberId: string, latencyMs: number): void {
  latencyWindow.push({ timestamp: Date.now(), latencyMs });
  if (latencyWindow.length > MAX_LATENCY_WINDOW) {
    latencyWindow.shift();
  }
  queueDepthSnapshot = Math.max(0, queueDepthSnapshot - 1);

  // Track subscriber timing
  let timing = subscriberTimings.get(subscriberId);
  if (!timing) {
    timing = { subscriberId, avgTimeMs: 0, totalDeliveries: 0, totalTimeMs: 0 };
    subscriberTimings.set(subscriberId, timing);
  }
  timing.totalDeliveries++;
  timing.totalTimeMs += latencyMs;
  timing.avgTimeMs = timing.totalTimeMs / timing.totalDeliveries;
}

export function recordEventDropped(event: Event, reason: string): void {
  queueDepthSnapshot = Math.max(0, queueDepthSnapshot - 1);
  console.warn(`[EVENT] dropped type=${event.type} reason=${reason} id=${event.id}`);
}

export function recordEventRetried(event: Event): void {
  // Counter is tracked in SQLite
}

export function recordEventRecovered(event: Event): void {
  // Counter is tracked in SQLite
}

export function updateActiveSubscriberCount(count: number): void {
  activeSubscriberCount = count;
}

export function getEventBusMetrics(): EventBusMetrics {
  const latencies = latencyWindow.map(l => l.latencyMs).sort((a, b) => a - b);

  const avgLatency = latencies.length > 0
    ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
    : 0;

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);

  // Get counter values from DB
  const { getEventDb } = require("./database");
  const db = getEventDb();
  const counters = db.prepare("SELECT name, value FROM event_counter").all() as { name: string; value: number }[];
  const counterMap = Object.fromEntries(counters.map(c => [c.name, c.value]));

  const published = counterMap["events_published"] || 0;
  const delivered = counterMap["events_delivered"] || 0;
  const dropped = counterMap["events_dropped"] || 0;
  const retried = counterMap["events_retried"] || 0;
  const recovered = counterMap["events_recovered"] || 0;
  const deadLettered = counterMap["events_dead_lettered"] || 0;

  const subscriberTimes = Array.from(subscriberTimings.values());
  const subscriberAvgTimeMs = subscriberTimes.length > 0
    ? subscriberTimes.reduce((sum, s) => sum + s.avgTimeMs, 0) / subscriberTimes.length
    : 0;

  const totalAttempts = delivered + dropped;
  const failureRate = totalAttempts > 0 ? dropped / totalAttempts : 0;

  const storedEventsRow = db.prepare("SELECT COUNT(*) as c FROM event_store").get() as { c: number };
  const dlqRow = db.prepare("SELECT COUNT(*) as c FROM dead_letter_queue WHERE resolved = 0").get() as { c: number };

  return {
    published,
    delivered,
    dropped,
    retried,
    recovered,
    deadLettered,
    avgLatencyMs: Math.round(avgLatency),
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    p99LatencyMs: p99,
    queueDepth: queueDepthSnapshot,
    subscriberAvgTimeMs: Math.round(subscriberAvgTimeMs),
    failureRate: Math.round(failureRate * 1000) / 1000,
    activeSubscriptions: activeSubscriberCount,
    storedEvents: storedEventsRow.c,
    deadLetterSize: dlqRow.c,
  };
}

export function resetMetrics(): void {
  latencyWindow.length = 0;
  subscriberTimings.clear();
  queueDepthSnapshot = 0;
  activeSubscriberCount = 0;

  const { getEventDb } = require("./database");
  const db = getEventDb();
  db.prepare("UPDATE event_counter SET value = 0").run();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}
