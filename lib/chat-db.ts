import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "chat_history.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      update_time INTEGER NOT NULL,
      user_id TEXT,
      pinned_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
      parts TEXT NOT NULL DEFAULT '[]',
      content TEXT,
      update_time INTEGER NOT NULL,
      model TEXT,
      mode TEXT,
      finish_reason TEXT,
      usage TEXT,
      PRIMARY KEY (id, chat_id),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_chats_update ON chats(update_time DESC);

    CREATE TABLE IF NOT EXISTS resume_checkpoints (
      chat_id TEXT PRIMARY KEY,
      goal TEXT NOT NULL DEFAULT '',
      planner_state TEXT NOT NULL DEFAULT '{}',
      execution_journal TEXT NOT NULL DEFAULT '[]',
      tool_outputs TEXT NOT NULL DEFAULT '{}',
      scratchpad TEXT NOT NULL DEFAULT '',
      working_memory TEXT NOT NULL DEFAULT '[]',
      resume_protocol TEXT NOT NULL DEFAULT '',
      messages_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );
  `);
}

// ── Chat operations ────────────────────────────────────────────────────

export interface StoredChat {
  _id: string;
  id: string;
  title: string;
  update_time: number;
  user_id?: string;
  pinned_at?: number;
}

export function getStoredChats(): StoredChat[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, update_time, user_id, pinned_at FROM chats ORDER BY update_time DESC`,
    )
    .all() as Array<{
      id: string;
      title: string;
      update_time: number;
      user_id: string | null;
      pinned_at: number | null;
    }>;
  return rows.map((r) => ({
    _id: r.id,
    id: r.id,
    title: r.title,
    update_time: r.update_time,
    user_id: r.user_id ?? undefined,
    pinned_at: r.pinned_at ?? undefined,
  }));
}

export function upsertStoredChat(chat: StoredChat): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO chats (id, title, update_time, user_id, pinned_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = COALESCE(excluded.title, title),
       update_time = excluded.update_time,
       user_id = COALESCE(excluded.user_id, user_id),
       pinned_at = COALESCE(excluded.pinned_at, pinned_at)`,
  ).run(
    chat.id,
    chat.title || "New Chat",
    chat.update_time || Date.now(),
    chat.user_id ?? null,
    chat.pinned_at ?? null,
  );
}

export function deleteStoredChat(chatId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM chats WHERE id = ?").run(chatId);
}

// ── Message operations ──────────────────────────────────────────────────

export interface StoredMessage {
  _id: string;
  id: string;
  chatId: string;
  role: "system" | "user" | "assistant";
  parts: unknown[];
  content?: string;
  update_time: number;
  model?: string;
  mode?: string;
  finish_reason?: string;
  usage?: unknown;
}

export function getStoredMessages(chatId: string): StoredMessage[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, chat_id, role, parts, content, update_time, model, mode, finish_reason, usage
       FROM messages WHERE chat_id = ? ORDER BY update_time ASC`,
    )
    .all(chatId) as Array<{
      id: string;
      chat_id: string;
      role: string;
      parts: string;
      content: string | null;
      update_time: number;
      model: string | null;
      mode: string | null;
      finish_reason: string | null;
      usage: string | null;
    }>;
  return rows.map((r) => ({
    _id: r.id,
    id: r.id,
    chatId: r.chat_id,
    role: r.role as "system" | "user" | "assistant",
    parts: safeJsonParse(r.parts, []) as unknown[],
    content: r.content ?? undefined,
    update_time: r.update_time,
    model: r.model ?? undefined,
    mode: r.mode ?? undefined,
    finish_reason: r.finish_reason ?? undefined,
    usage: safeJsonParse(r.usage ?? "null", undefined),
  }));
}

export function setStoredMessages(
  chatId: string,
  messages: StoredMessage[],
): void {
  const db = getDb();
  const upsert = db.transaction(() => {
    // Delete existing messages for this chat
    db.prepare("DELETE FROM messages WHERE chat_id = ?").run(chatId);
    // Insert all messages
    const insert = db.prepare(
      `INSERT INTO messages (id, chat_id, role, parts, content, update_time, model, mode, finish_reason, usage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const msg of messages) {
      insert.run(
        msg.id,
        chatId,
        msg.role,
        JSON.stringify(msg.parts ?? []),
        msg.content ?? null,
        msg.update_time || Date.now(),
        msg.model ?? null,
        msg.mode ?? null,
        msg.finish_reason ?? null,
        msg.usage ? JSON.stringify(msg.usage) : null,
      );
    }
  });
  upsert();
}

export function appendStoredMessage(
  chatId: string,
  message: StoredMessage,
): void {
  const db = getDb();
  // Ensure the chat row exists before inserting a message (FK constraint)
  db.prepare(
    `INSERT OR IGNORE INTO chats (id, title, update_time)
     VALUES (?, ?, ?)`,
  ).run(
    chatId,
    "New Chat",
    Date.now(),
  );
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, parts, content, update_time, model, mode, finish_reason, usage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id, chat_id) DO UPDATE SET
       role = excluded.role,
       parts = excluded.parts,
       content = excluded.content,
       update_time = excluded.update_time,
       model = excluded.model,
       mode = excluded.mode,
       finish_reason = excluded.finish_reason,
       usage = excluded.usage`,
  ).run(
    message.id,
    chatId,
    message.role,
    JSON.stringify(message.parts ?? []),
    message.content ?? null,
    message.update_time || Date.now(),
    message.model ?? null,
    message.mode ?? null,
    message.finish_reason ?? null,
    message.usage ? JSON.stringify(message.usage) : null,
  );
}

// ── Migration: import data from localStorage ────────────────────────────

export function migrateFromLocalStorage(
  localChats: StoredChat[],
  localMessages: Record<string, StoredMessage[]>,
): void {
  const db = getDb();
  const migrate = db.transaction(() => {
    for (const chat of localChats) {
      upsertStoredChat(chat);
    }
    for (const [chatId, msgs] of Object.entries(localMessages)) {
      for (const msg of msgs) {
        appendStoredMessage(chatId, msg);
      }
    }
  });
  migrate();
  console.log(
    `[chat-db] Migrated ${localChats.length} chats with ${Object.values(localMessages).reduce((a, m) => a + m.length, 0)} messages from localStorage → SQLite`,
  );
}

// ── Durable Resume Checkpoints ────────────────────────────────────────

export interface ResumeCheckpoint {
  chatId: string;
  goal: string;
  plannerState: Record<string, unknown>;
  executionJournal: Array<{ agent: string; tool: string; status: string; ts: number }>;
  toolOutputs: Record<string, unknown>;
  scratchpad: string;
  workingMemory: string[];
  resumeProtocol: string;
  messagesJson: unknown[];
  updatedAt: number;
}

export function saveResumeCheckpoint(checkpoint: ResumeCheckpoint): void {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO resume_checkpoints
    (chat_id, goal, planner_state, execution_journal, tool_outputs, scratchpad, working_memory, resume_protocol, messages_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    checkpoint.chatId, checkpoint.goal,
    JSON.stringify(checkpoint.plannerState),
    JSON.stringify(checkpoint.executionJournal),
    JSON.stringify(checkpoint.toolOutputs),
    checkpoint.scratchpad,
    JSON.stringify(checkpoint.workingMemory),
    checkpoint.resumeProtocol,
    JSON.stringify(checkpoint.messagesJson),
    checkpoint.updatedAt,
  );
}

export function getResumeCheckpoint(chatId: string): ResumeCheckpoint | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM resume_checkpoints WHERE chat_id = ?").get(chatId) as any;
  if (!row) return null;
  return {
    chatId: row.chat_id,
    goal: row.goal,
    plannerState: safeJsonParse(row.planner_state, {}),
    executionJournal: safeJsonParse(row.execution_journal, []),
    toolOutputs: safeJsonParse(row.tool_outputs, {}),
    scratchpad: row.scratchpad || "",
    workingMemory: safeJsonParse(row.working_memory, []),
    resumeProtocol: row.resume_protocol || "",
    messagesJson: safeJsonParse(row.messages_json, []),
    updatedAt: row.updated_at,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function safeJsonParse(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
