// @module events/dead-letter-queue v1.0.0 — Dead Letter Queue for failed events

import { getEventDb } from "./database";
import { persistEvent, loadEvent } from "./persistence";
import type { Event, StoredEvent, DeadLetterEntry } from "./types";
import { randomUUID } from "crypto";

function getDb() {
  return getEventDb();
}

export function enqueueDeadLetter(
  event: Event,
  subscriberId: string,
  failureReason: string,
  stackTrace?: string,
  recoveryRecommendation?: string,
): DeadLetterEntry {
  const db = getDb();
  const now = Date.now();
  const id = `dlq-${randomUUID()}`;

  // Persist the event first to satisfy FK constraint
  const { persistEvent } = require("./persistence");
  const existing = db.prepare("SELECT id FROM event_store WHERE id = ?").get(event.id);
  if (!existing) {
    persistEvent(event, event.metadata.priority || "medium");
  }

  const maxRetries = event.metadata.maxRetries || 5;
  const retryDelay = calculateRetryDelay(0);

  db.prepare(`
    INSERT OR REPLACE INTO dead_letter_queue (
      id, event_id, event_json, failure_reason, stack_trace,
      subscriber_id, recovery_recommendation,
      retry_attempts, max_retry_attempts, next_retry_at,
      acknowledged, resolved, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 0, ?, ?)
  `).run(
    id, event.id, JSON.stringify(event), failureReason, stackTrace || null,
    subscriberId, recoveryRecommendation || null,
    maxRetries, now + retryDelay,
    now, now,
  );

  // Mark original event as dead
  db.prepare("UPDATE event_store SET status = 'dead' WHERE id = ?").run(event.id);

  // Increment counter
  db.prepare("UPDATE event_counter SET value = value + 1 WHERE name = 'events_dead_lettered'").run();

  return loadDeadLetterEntry(id)!;
}

export function loadDeadLetterEntry(id: string): DeadLetterEntry | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM dead_letter_queue WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToEntry(row);
}

export function getPendingRetries(limit = 10): DeadLetterEntry[] {
  const db = getDb();
  const now = Date.now();
  const rows = db.prepare(
    "SELECT * FROM dead_letter_queue WHERE resolved = 0 AND acknowledged = 0 AND next_retry_at <= ? ORDER BY next_retry_at ASC LIMIT ?"
  ).all(now, limit) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

export function getAllDeadLetters(limit = 100, offset = 0): DeadLetterEntry[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM dead_letter_queue ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).all(limit, offset) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

export function acknowledgeDeadLetter(id: string): void {
  const db = getDb();
  db.prepare("UPDATE dead_letter_queue SET acknowledged = 1, updated_at = ? WHERE id = ?")
    .run(Date.now(), id);
}

export function resolveDeadLetter(id: string): void {
  const db = getDb();
  db.prepare("UPDATE dead_letter_queue SET resolved = 1, acknowledged = 1, updated_at = ? WHERE id = ?")
    .run(Date.now(), id);
}

export function scheduleRetry(id: string, attempt: number): void {
  const db = getDb();
  const delay = calculateRetryDelay(attempt);
  const nextRetryAt = Date.now() + delay;
  db.prepare(
    "UPDATE dead_letter_queue SET retry_attempts = ?, next_retry_at = ?, updated_at = ? WHERE id = ?"
  ).run(attempt, nextRetryAt, Date.now(), id);
}

export function getDeadLetterCount(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as c FROM dead_letter_queue WHERE resolved = 0").get() as { c: number };
  return row.c;
}

export function purgeResolvedDeadLetters(olderThanDays = 7): number {
  const db = getDb();
  const cutoff = Date.now() - olderThanDays * 86400000;
  const result = db.prepare("DELETE FROM dead_letter_queue WHERE resolved = 1 AND updated_at < ?").run(cutoff);
  return result.changes;
}

function calculateRetryDelay(attempt: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 64s (max)
  const delays = [1000, 2000, 4000, 8000, 16000, 32000, 64000];
  return delays[Math.min(attempt, delays.length - 1)];
}

function rowToEntry(row: Record<string, unknown>): DeadLetterEntry {
  const eventJson = JSON.parse(row.event_json as string);
  return {
    event: {
      ...eventJson,
      status: "dead",
    },
    failureReason: row.failure_reason as string,
    stackTrace: row.stack_trace as string | undefined,
    subscriberId: row.subscriber_id as string,
    recoveryRecommendation: row.recovery_recommendation as string | undefined,
    retryAttempts: row.retry_attempts as number,
    maxRetryAttempts: row.max_retry_attempts as number,
    nextRetryAt: row.next_retry_at as number | undefined,
    acknowledged: !!(row.acknowledged as number),
    resolved: !!(row.resolved as number),
  };
}
