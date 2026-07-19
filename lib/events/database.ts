// @module events/database v1.0.0 — SQLite event store for Event Bus

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

let db: Database.Database | null = null;

export function getEventDb(): Database.Database {
  if (db) return db;

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "events.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_store (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'pending',
      timestamp INTEGER NOT NULL,
      stored_at INTEGER NOT NULL,
      delivered_at INTEGER,
      failed_at INTEGER,
      failure_reason TEXT,
      correlation_id TEXT,
      causation_id TEXT,
      mission_id TEXT,
      workspace_id TEXT,
      user_id TEXT,
      session_id TEXT,
      executive_id TEXT,
      department_id TEXT,
      agent_id TEXT,
      chat_id TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      ttl INTEGER,
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '1.0.0',
      subscriber_id TEXT,
      replay_of TEXT,
      replay_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_event_store_type ON event_store(type);
    CREATE INDEX IF NOT EXISTS idx_event_store_category ON event_store(category);
    CREATE INDEX IF NOT EXISTS idx_event_store_status ON event_store(status);
    CREATE INDEX IF NOT EXISTS idx_event_store_timestamp ON event_store(timestamp);
    CREATE INDEX IF NOT EXISTS idx_event_store_correlation ON event_store(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_event_store_mission ON event_store(mission_id);
    CREATE INDEX IF NOT EXISTS idx_event_store_workspace ON event_store(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_event_store_chat ON event_store(chat_id);

    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      event_json TEXT NOT NULL,
      failure_reason TEXT NOT NULL,
      stack_trace TEXT,
      subscriber_id TEXT NOT NULL,
      recovery_recommendation TEXT,
      retry_attempts INTEGER NOT NULL DEFAULT 0,
      max_retry_attempts INTEGER NOT NULL DEFAULT 5,
      next_retry_at INTEGER,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (event_id) REFERENCES event_store(id)
    );

    CREATE INDEX IF NOT EXISTS idx_dlq_event_id ON dead_letter_queue(event_id);
    CREATE INDEX IF NOT EXISTS idx_dlq_resolved ON dead_letter_queue(resolved);
    CREATE INDEX IF NOT EXISTS idx_dlq_next_retry ON dead_letter_queue(next_retry_at);

    CREATE TABLE IF NOT EXISTS event_baselines (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      avg_latency_ms REAL NOT NULL DEFAULT 0,
      p95_latency_ms REAL NOT NULL DEFAULT 0,
      success_rate REAL NOT NULL DEFAULT 1.0,
      sample_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_event_baselines_type ON event_baselines(event_type);

    CREATE TABLE IF NOT EXISTS event_counter (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );

    -- Pre-populate counters
    INSERT OR IGNORE INTO event_counter (name, value) VALUES
      ('events_published', 0),
      ('events_delivered', 0),
      ('events_dropped', 0),
      ('events_retried', 0),
      ('events_recovered', 0),
      ('events_dead_lettered', 0);
  `);
}

export function closeEventDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
