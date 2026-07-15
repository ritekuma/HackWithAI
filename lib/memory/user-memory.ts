// ── Long-Term User Memory ──
// Persistent cross-chat user facts. Independent of chat/mission memory.

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// ── Types ─────────────────────────────────────────────────────────────
export type MemoryCategory = "identity" | "preferences" | "language" | "projects" | "environment" | "coding" | "tools" | "models" | "infrastructure" | "business" | "security" | "workflow";

export interface UserMemory {
  id: string;
  category: MemoryCategory;
  fact: string;
  confidence: number;
  verified: boolean;
  source: string;
  importance: number;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
  lastUsed: number;
  embedding?: string;
  version: number;
}

export interface MemorySearchResult {
  memory: UserMemory;
  score: number;
}

// ── SQLite ────────────────────────────────────────────────────────────
const DB_PATH = path.join(process.cwd(), "data", "user_memory.db");
let _db: Database.Database | null = null;

function getDb(): Database.Database {
  // Check if cached connection is still valid (survives hot-reload)
  if (_db) {
    try { _db.pragma("quick_check"); return _db; }
    catch { _db = null; } // connection severed by hot-reload, reopen
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS user_memory (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      fact TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      verified INTEGER DEFAULT 0,
      source TEXT DEFAULT '',
      importance REAL DEFAULT 0.5,
      usage_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used INTEGER NOT NULL,
      embedding TEXT DEFAULT '',
      version INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_mem_category ON user_memory(category);
  `);
  return _db;
}

// ── Pattern Detection ─────────────────────────────────────────────────
const IDENTITY_PATTERNS: [RegExp, MemoryCategory][] = [
  [/\b(my name is|i am|call me|i'm called)\s+(.+?)[.!?\n]/i, "identity"],
  [/\b(i (?:would |always |never |really )?prefer|my preferred|i like(?! to )|my favourite)\s+(.+?)[.!?\n]/i, "preferences"],
  [/\b(?:please )?(answer|respond|write|speak|reply)\s+(?:to me\s+)?(?:always\s+)?in\s+(.+?)[.!?\n]/i, "language"],
  [/\b(my (?:primary |main |current |personal )?project|codenamed?)\s+(?:is |called )?\s*(.+?)[.!?\n]/i, "projects"],
  [/\b(i (use|work with|develop on|code on|run on))\s+(.+?)[.!?\n]/i, "environment"],
  [/\b(my (?:coding|dev) (?:style|preference))\s+(?:is )?(.+?)[.!?\n]/i, "coding"],
  [/\b(i always use|my go-to tool|my primary tool)\s+(.+?)[.!?\n]/i, "tools"],
  [/\b(my (?:favourite|preferred|go-to) model)\s+(?:is )?(.+?)[.!?\n]/i, "models"],
  [/\bi (?:always|never)\s+(\w.{3,80}?)[.!?\n]/i, "preferences"],
];

// Words that should not be saved as standalone preference facts.
// If a preference pattern produces one of these, skip it.
const FILLER_WORDS = new Set(["model", "tool", "framework", "editor", "ide", "language", "os", "distro", "browser", "theme", "color", "font", "size", "plugin", "extension", "keyboard", "mouse", "screen"]);

/** Detect potential user facts from text. Returns fact + category + confidence. */
function detectFacts(text: string): { fact: string; category: MemoryCategory; confidence: number }[] {
  const results: { fact: string; category: MemoryCategory; confidence: number }[] = [];
  for (const [pattern, category] of IDENTITY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const fact = match[2] || match[3] || match[4] || match[1];
      if (fact && fact.length > 1 && fact.length < 200) {
        const lowerFact = fact.trim().toLowerCase();
        if (FILLER_WORDS.has(lowerFact)) continue;
        results.push({ fact: fact.trim(), category, confidence: 0.7 });
      }
    }
  }
  return results;
}

// ── Safety filter ─────────────────────────────────────────────────────
const BLOCKED = /password|token|key|secret|api.key|private.key|otp|session|auth|credential|bank|credit.card/gi;

function isSafe(fact: string): boolean {
  return !BLOCKED.test(fact) && fact.length < 500;
}

// ── Forensic logging ──────────────────────────────────────────────────
function flog(msg: string) { console.error(`[UMEM] ${msg}`); }

// ── API ───────────────────────────────────────────────────────────────

export function saveUserMemory(fact: string, category: MemoryCategory, confidence = 0.7, source = "auto-detected"): UserMemory | null {
  if (!isSafe(fact)) { flog(`SAFE-REJECT: "${fact.substring(0,50)}"`); return null; }

  const db = getDb();

  const existing = db.prepare("SELECT id, fact, version, confidence FROM user_memory WHERE category=? AND fact LIKE ? LIMIT 1")
    .get(category, `%${fact.substring(0, 30)}%`) as any;

  const now = Date.now();

  if (existing) {
    db.prepare("UPDATE user_memory SET fact=?, confidence=?, updated_at=?, version=version+1, usage_count=usage_count+1, last_used=? WHERE id=?")
      .run(fact, Math.max(existing.confidence, confidence), now, now, existing.id);
    flog(`UPDATE [${category}] "${fact}" v${existing.version+1} (was "${existing.fact.substring(0,40)}")`);
    return { id: existing.id, category, fact, confidence: Math.max(existing.confidence, confidence), verified: confidence >= 0.9, source, importance: 0.5, usageCount: (existing.usage_count || 0) + 1, createdAt: now, updatedAt: now, lastUsed: now, version: existing.version + 1 };
  }

  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  db.prepare("INSERT INTO user_memory (id,category,fact,confidence,verified,source,importance,usage_count,created_at,updated_at,last_used,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, category, fact, confidence, confidence >= 0.9 ? 1 : 0, source, 0.5, 1, now, now, now, 1);
  flog(`INSERT [${category}] "${fact}" id=${id}`);

  return { id, category, fact, confidence, verified: confidence >= 0.9, source, importance: 0.5, usageCount: 1, createdAt: now, updatedAt: now, lastUsed: now, version: 1 };
}

// Semantic query expansion: map common query terms → category
const QUERY_CATEGORY_MAP: Record<string, MemoryCategory> = {
  name: "identity", who: "identity", called: "identity",
  prefer: "preferences", like: "preferences", favourite: "preferences", favorite: "preferences",
  language: "language", speak: "language", answer: "language", respond: "language",
  project: "projects", codebase: "projects", repo: "projects",
  os: "environment", system: "environment", machine: "environment", hardware: "environment",
  code: "coding", style: "coding", format: "coding",
  tool: "tools", editor: "tools", ide: "tools",
  model: "models", ai: "models", llm: "models",
};

export function searchUserMemory(query: string, limit = 10): MemorySearchResult[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM user_memory WHERE verified=1 OR confidence>=0.7 ORDER BY importance DESC, usage_count DESC LIMIT 50"
  ).all() as any[];

  if (rows.length === 0) { flog(`DB empty — 0 memories`); return []; }

  // Always return all memories ranked by relevance. Semantic scoring
  // boosts matching ones but never filters out memories that don't
  // match random query words (code, file paths, etc.).
  const q = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const results: MemorySearchResult[] = [];

  for (const row of rows) {
    let score = row.confidence * row.importance; // baseline
    const f = row.fact.toLowerCase();
    for (const word of q) {
      if (f.includes(word)) score += 2;
      if (row.category.includes(word)) score += 1;
      if (QUERY_CATEGORY_MAP[word] === row.category) score += 3;
    }

    results.push({
      memory: {
        id: row.id, category: row.category, fact: row.fact,
        confidence: row.confidence, verified: !!row.verified, source: row.source,
        importance: row.importance, usageCount: row.usage_count,
        createdAt: row.created_at, updatedAt: row.updated_at, lastUsed: row.last_used,
        version: row.version,
      },
      score,
    });
  }

  const sorted = results.sort((a, b) => b.score - a.score).slice(0, limit);
  flog(`search: q="${query.substring(0,40)}" db=${rows.length} matches=${sorted.length} top=${sorted[0]?.memory.fact || 'none'}`);
  return sorted;
}

export function getRelevantMemories(query: string): string[] {
  const results = searchUserMemory(query, 10);
  if (results.length === 0) { flog(`INJECT: 0 memories for "${query.substring(0,40)}" — BLOCK EMPTY`); return []; }

  flog(`INJECT: ${results.length} memories for "${query.substring(0,40)}"`);
  return [
    "=== USER MEMORY ===",
    ...results.map(r => `- [${r.memory.category}] ${r.memory.fact}`),
    "=== END USER MEMORY ===\n",
  ];
}

export function getAllUserMemory(): UserMemory[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM user_memory ORDER BY last_used DESC LIMIT 100").all() as any[])
    .map((r: any) => ({ id: r.id, category: r.category, fact: r.fact, confidence: r.confidence, verified: !!r.verified, source: r.source, importance: r.importance, usageCount: r.usage_count, createdAt: r.created_at, updatedAt: r.updated_at, lastUsed: r.last_used, version: r.version }));
}

export function extractAndSaveFacts(text: string, source = "conversation"): number {
  const facts = detectFacts(text);
  flog(`extract: text="${text.substring(0,50)}" detected=${facts.length}`);
  let saved = 0;
  for (const f of facts) {
    if (saveUserMemory(f.fact, f.category, f.confidence, source)) saved++;
  }
  return saved;
}

export function deleteUserMemory(id: string): boolean {
  const db = getDb();
  const r = db.prepare("DELETE FROM user_memory WHERE id=?").run(id);
  return r.changes > 0;
}
