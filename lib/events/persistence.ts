// @module events/persistence v1.0.0 — Event persistence layer (SQLite)

import { getEventDb } from "./database";
import type { Event, StoredEvent, EventPriority, EventStatus, EventCategory } from "./types";
import { randomUUID } from "crypto";

function getDb() {
  return getEventDb();
}

export function persistEvent(event: Event, priority: EventPriority = "medium"): StoredEvent {
  const db = getDb();
  const now = Date.now();

  const tagsJson = JSON.stringify(event.metadata.tags || []);
  const payloadJson = JSON.stringify(event.payload);

  db.prepare(`
    INSERT OR REPLACE INTO event_store (
      id, type, payload, category, priority, status, timestamp, stored_at,
      correlation_id, causation_id, mission_id, workspace_id, user_id,
      session_id, executive_id, department_id, agent_id, chat_id,
      retry_count, max_retries, ttl, tags, source, version,
      replay_of, replay_count
    ) VALUES (
      ?, ?, ?, ?, ?, 'pending', ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?
    )
  `).run(
    event.id, event.type, payloadJson,
    getCategoryFromType(event.type), priority,
    event.metadata.timestamp, now,
    event.metadata.correlationId, event.metadata.causationId || null,
    event.metadata.missionId || null, event.metadata.workspaceId || null,
    event.metadata.userId || null, event.metadata.sessionId || null,
    event.metadata.executiveId || null, event.metadata.departmentId || null,
    event.metadata.agentId || null, event.metadata.chatId || null,
    event.metadata.retryCount, event.metadata.maxRetries,
    event.metadata.ttl || null, tagsJson,
    event.metadata.source, event.metadata.version,
    null, 0,
  );

  incrementCounter("events_published");

  return loadEvent(event.id) as StoredEvent;
}

export function loadEvent(id: string): StoredEvent | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM event_store WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToStoredEvent(row);
}

export function loadEvents(filter: {
  types?: string[];
  categories?: string[];
  missionId?: string;
  workspaceId?: string;
  correlationId?: string;
  chatId?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  status?: string;
  limit?: number;
  offset?: number;
}): StoredEvent[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.types?.length) {
    clauses.push(`type IN (${filter.types.map(() => "?").join(",")})`);
    params.push(...filter.types);
  }
  if (filter.categories?.length) {
    clauses.push(`category IN (${filter.categories.map(() => "?").join(",")})`);
    params.push(...filter.categories);
  }
  if (filter.missionId) {
    clauses.push("mission_id = ?");
    params.push(filter.missionId);
  }
  if (filter.workspaceId) {
    clauses.push("workspace_id = ?");
    params.push(filter.workspaceId);
  }
  if (filter.correlationId) {
    clauses.push("correlation_id = ?");
    params.push(filter.correlationId);
  }
  if (filter.chatId) {
    clauses.push("chat_id = ?");
    params.push(filter.chatId);
  }
  if (filter.fromTimestamp) {
    clauses.push("timestamp >= ?");
    params.push(filter.fromTimestamp);
  }
  if (filter.toTimestamp) {
    clauses.push("timestamp <= ?");
    params.push(filter.toTimestamp);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filter.limit || 100;
  const offset = filter.offset || 0;

  const rows = db.prepare(
    `SELECT * FROM event_store ${where} ORDER BY timestamp ASC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as Record<string, unknown>[];

  return rows.map(rowToStoredEvent);
}

export function markDelivered(id: string, subscriberId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE event_store SET status = 'delivered', delivered_at = ?, subscriber_id = ? WHERE id = ?
  `).run(Date.now(), subscriberId, id);
  incrementCounter("events_delivered");
}

export function markFailed(id: string, subscriberId: string, reason: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE event_store SET status = 'failed', failed_at = ?, failure_reason = ?, subscriber_id = ? WHERE id = ?
  `).run(Date.now(), reason, subscriberId, id);
}

export function incrementRetry(id: string): void {
  const db = getDb();
  db.prepare("UPDATE event_store SET retry_count = retry_count + 1 WHERE id = ?").run(id);
  incrementCounter("events_retried");
}

export function markRecovered(id: string): void {
  const db = getDb();
  db.prepare("UPDATE event_store SET status = 'delivered', failure_reason = NULL, failed_at = NULL WHERE id = ?").run(id);
  incrementCounter("events_recovered");
}

export function markReplayed(id: string, newEventId: string): void {
  const db = getDb();
  db.prepare("UPDATE event_store SET status = 'replayed' WHERE id = ?").run(id);
  db.prepare("UPDATE event_store SET replay_of = ?, replay_count = replay_count + 1 WHERE id = ?")
    .run(id, newEventId);
}

export function purgeExpiredEvents(): number {
  const db = getDb();
  const now = Date.now();
  const result = db.prepare("DELETE FROM event_store WHERE ttl IS NOT NULL AND ttl > 0 AND (stored_at + ttl) < ?").run(now);
  return result.changes;
}

export function getEventCount(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as c FROM event_store").get() as { c: number };
  return row.c;
}

function incrementCounter(name: string): void {
  const db = getDb();
  db.prepare("UPDATE event_counter SET value = value + 1 WHERE name = ?").run(name);
}

function getCategoryFromType(type: string): string {
  const prefix = type.split(":")[0];
  const validCategories = ["mission", "tool", "executive", "memory", "workspace", "recovery", "simulation", "system", "audit", "telemetry", "chat", "agent"];
  return validCategories.includes(prefix) ? prefix : "system";
}

function rowToStoredEvent(row: Record<string, unknown>): StoredEvent {
  return {
    id: row.id as string,
    type: row.type as string,
    payload: JSON.parse(row.payload as string),
    category: (row.category as string) as EventCategory,
    priority: (row.priority as string) as EventPriority,
    status: (row.status as string) as EventStatus,
    metadata: {
      timestamp: row.timestamp as number,
      correlationId: row.correlation_id as string,
      causationId: (row.causation_id as string) || undefined,
      missionId: (row.mission_id as string) || undefined,
      workspaceId: (row.workspace_id as string) || undefined,
      userId: (row.user_id as string) || undefined,
      sessionId: (row.session_id as string) || undefined,
      executiveId: (row.executive_id as string) || undefined,
      departmentId: (row.department_id as string) || undefined,
      agentId: (row.agent_id as string) || undefined,
      chatId: (row.chat_id as string) || undefined,
      priority: (row.priority as EventPriority) || "medium",
      retryCount: row.retry_count as number,
      maxRetries: row.max_retries as number,
      ttl: row.ttl as number | undefined,
      tags: JSON.parse((row.tags as string) || "[]"),
      source: (row.source as string) || "",
      version: (row.version as string) || "1.0.0",
    },
    storedAt: row.stored_at as number,
    deliveredAt: row.delivered_at as number | undefined,
    failedAt: row.failed_at as number | undefined,
    failureReason: row.failure_reason as string | undefined,
    subscriberId: row.subscriber_id as string | undefined,
    replayOf: row.replay_of as string | undefined,
    replayCount: row.replay_count as number,
  };
}

export function generateEventId(): string {
  return randomUUID();
}

export function generateCorrelationId(): string {
  return randomUUID();
}
