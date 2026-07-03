import {
  coerceSelectedModel,
  isChatMode,
  type ChatMode,
  type SelectedModel,
} from "@/types/chat";

export type ConversationDraft = {
  id: string;
  content: string;
  timestamp: number;
};

export type ConversationDraftStore = {
  drafts: Array<ConversationDraft>;
  userId?: string;
};

export const CONVERSATION_DRAFTS_STORAGE_KEY = "conversation_drafts";
export const NULL_THREAD_DRAFT_ID = "null_thread";
export const CHAT_MODE_STORAGE_KEY = "chat_mode";
const HAS_AUTHENTICATED_BEFORE_STORAGE_KEY = "hwai_has_authed_before";
const SELECTED_MODEL_STORAGE_KEY = "selected_model";

const isBrowser = (): boolean => typeof window !== "undefined";

export const readDraftStore = (): ConversationDraftStore => {
  if (!isBrowser()) return { drafts: [] };
  try {
    const raw = window.localStorage.getItem(CONVERSATION_DRAFTS_STORAGE_KEY);
    if (!raw) return { drafts: [] };
    const parsed = JSON.parse(raw);
    const drafts = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
    const userId =
      typeof parsed?.userId === "string" ? parsed.userId : undefined;
    return { drafts, userId };
  } catch {
    return { drafts: [] };
  }
};

export const writeDraftStore = (store: ConversationDraftStore): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      CONVERSATION_DRAFTS_STORAGE_KEY,
      JSON.stringify({ drafts: store.drafts, userId: store.userId }),
    );
  } catch {
    // ignore
  }
};

export const readChatMode = (): ChatMode | null => {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(CHAT_MODE_STORAGE_KEY);
    return isChatMode(raw) ? raw : null;
  } catch {
    return null;
  }
};

export const writeChatMode = (mode: ChatMode): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(CHAT_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
};

export const markHasAuthenticatedBefore = (): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(HAS_AUTHENTICATED_BEFORE_STORAGE_KEY, "true");
  } catch {
    // ignore
  }
};

export const hasAuthenticatedBefore = (): boolean => {
  if (!isBrowser()) return false;
  try {
    return (
      window.localStorage.getItem(HAS_AUTHENTICATED_BEFORE_STORAGE_KEY) ===
      "true"
    );
  } catch {
    return false;
  }
};

/**
 * Read the saved model preference (shared across ask + agent modes).
 * Migrates two flavors of legacy values when present:
 *   1. Per-mode keys from before the unified preference: `selected_model_ask`
 *      and `selected_model_agent`.
 *   2. Underlying-model ids from before the HackWithAI v2 tier rebrand
 *      (e.g. `"opus-4.6"` → `"hwai-max"`) — handled by `coerceSelectedModel`.
 * Both kinds are rewritten to the unified key in their new form so the
 * migration is a one-shot.
 */
export const readSelectedModel = (): string | null => {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
    const coerced = coerceSelectedModel(raw);
    if (coerced) {
      // If the stored value was a legacy underlying-model id, rewrite it.
      if (raw !== coerced) {
        window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, coerced);
      }
      return coerced;
    }
    // Migrate from legacy per-mode keys (selected_model_ask / selected_model_agent).
    const legacyAsk = window.localStorage.getItem(
      `${SELECTED_MODEL_STORAGE_KEY}_ask`,
    );
    const legacyAgent = window.localStorage.getItem(
      `${SELECTED_MODEL_STORAGE_KEY}_agent`,
    );
    const legacy =
      coerceSelectedModel(legacyAsk) ?? coerceSelectedModel(legacyAgent);
    if (legacy) {
      window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, legacy);
      window.localStorage.removeItem(`${SELECTED_MODEL_STORAGE_KEY}_ask`);
      window.localStorage.removeItem(`${SELECTED_MODEL_STORAGE_KEY}_agent`);
    }
    return legacy;
  } catch {
    return null;
  }
};

/** Save the model preference (shared across ask + agent modes). */
export const writeSelectedModel = (model: string): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, model);
  } catch {
    // ignore
  }
};

/** Remove the persisted model preference (and any legacy per-mode keys) — e.g. on logout. */
export const clearSelectedModelFromStorage = (): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(SELECTED_MODEL_STORAGE_KEY);
    window.localStorage.removeItem(`${SELECTED_MODEL_STORAGE_KEY}_ask`);
    window.localStorage.removeItem(`${SELECTED_MODEL_STORAGE_KEY}_agent`);
  } catch {
    // ignore
  }
};

export const getDraftContentById = (id: string): string | null => {
  const store = readDraftStore();
  const entry = store.drafts.find((d) => d.id === id);
  return entry ? entry.content : null;
};

export const upsertDraft = (
  id: string,
  content: string,
  timestamp?: number,
): void => {
  const store = readDraftStore();
  const idx = store.drafts.findIndex((d) => d.id === id);
  const entry: ConversationDraft = {
    id,
    content,
    timestamp: typeof timestamp === "number" ? timestamp : Date.now(),
  };
  if (idx >= 0) {
    store.drafts[idx] = entry;
  } else {
    store.drafts.push(entry);
  }
  writeDraftStore(store);
};

export const removeDraft = (id: string): void => {
  const store = readDraftStore();
  const nextDrafts = store.drafts.filter((d) => d.id !== id);
  writeDraftStore({ ...store, drafts: nextDrafts });
};

export const getDrafts = (): Array<ConversationDraft> =>
  readDraftStore().drafts;

export const getUserIdFromDrafts = (): string | undefined =>
  readDraftStore().userId;

export const setUserIdInDrafts = (userId: string): void => {
  const store = readDraftStore();
  writeDraftStore({ ...store, userId });
};

export const clearAllDrafts = (): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(CONVERSATION_DRAFTS_STORAGE_KEY);
  } catch {
    // ignore
  }
};

/**
 * Removes drafts older than 7 days
 * Called on app initialization to prevent localStorage bloat
 */
export const cleanupExpiredDrafts = (): void => {
  if (!isBrowser()) return;

  try {
    const store = readDraftStore();
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    // Filter out drafts older than 7 days
    const validDrafts = store.drafts.filter((draft) => {
      const age = now - draft.timestamp;
      return age < SEVEN_DAYS_MS;
    });

    // Only write if we actually removed drafts (avoid unnecessary writes)
    if (validDrafts.length !== store.drafts.length) {
      writeDraftStore({ ...store, drafts: validDrafts });
      console.log(
        `[Draft Cleanup] Removed ${store.drafts.length - validDrafts.length} expired drafts`,
      );
    }
  } catch (error) {
    // Silently fail - cleanup is not critical
    console.warn("[Draft Cleanup] Failed to cleanup expired drafts:", error);
  }
};

// ── Local-only mode chat persistence (SQLite-backed, localStorage cache) ──
// Primary storage: SQLite database accessed via /api/chats REST API
// Secondary cache: localStorage for fast reads and offline fallback
const LOCAL_CHATS_KEY = "hwai_local_chats";
const LOCAL_MSGS_PREFIX = "hwai_local_msgs_";
const MIGRATED_KEY = "hwai_sqlite_migrated_v2";

interface StoredChat {
  _id: string;
  id: string;
  title: string;
  update_time: number;
  user_id?: string;
  pinned_at?: number;
}

interface StoredMessage {
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

// ── Migration & initial load helper ─────────────────────────────────────
let initPromise: Promise<void> | null = null;

export function getStorageInitPromise(): Promise<void> | null {
  return initPromise;
}

async function initializeStorage(): Promise<void> {
  if (typeof window === "undefined") return;

  const alreadyMigrated = window.localStorage.getItem(MIGRATED_KEY) === "true";

  if (!alreadyMigrated) {
    // First time: migrate localStorage → SQLite
    try {
      const rawChats = window.localStorage.getItem(LOCAL_CHATS_KEY);
      const localChats: StoredChat[] = rawChats ? JSON.parse(rawChats) : [];

      const localMessages: Record<string, StoredMessage[]> = {};
      for (const chat of localChats) {
        const rawMsgs = window.localStorage.getItem(`${LOCAL_MSGS_PREFIX}${chat.id}`);
        if (rawMsgs) {
          localMessages[chat.id] = JSON.parse(rawMsgs);
        }
      }

      if (localChats.length > 0) {
        await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "migrate",
            chats: localChats,
            messages: localMessages,
          }),
        });
      }
      window.localStorage.setItem(MIGRATED_KEY, "true");
      console.log("[chat-storage] Migrated to SQLite:", localChats.length, "chats");
    } catch (err) {
      console.warn("[chat-storage] Migration deferred:", err);
    }
  }

  // Always refresh localStorage cache from SQLite on load
  try {
    const res = await fetch("/api/chats");
    if (res.ok) {
      const data = await res.json();
      const chats: StoredChat[] = data.chats || [];
      syncSetChats(chats);

      // Preload messages for all chats
      for (const chat of chats) {
        const msgRes = await fetch(
          `/api/chats/${encodeURIComponent(chat.id)}/messages`,
        );
        if (msgRes.ok) {
          const msgData = await msgRes.json();
          syncSetMessages(chat.id, msgData.messages || []);
        }
      }
      console.log("[chat-storage] Refreshed cache from SQLite:", chats.length, "chats");
    }
  } catch (err) {
    console.warn("[chat-storage] Failed to refresh cache:", err);
  }
}

// Initialize on first import (client-side only)
if (typeof window !== "undefined") {
  initPromise = initializeStorage();
}

// ── API-backed storage (primary) with localStorage cache (fallback) ─────

async function apiGetChats(): Promise<StoredChat[]> {
  try {
    const res = await fetch("/api/chats");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Cache in localStorage for fast access
    try {
      localStorage.setItem(LOCAL_CHATS_KEY, JSON.stringify(data.chats));
    } catch {}
    return data.chats;
  } catch {
    // Fallback to localStorage cache
    try {
      const raw = localStorage.getItem(LOCAL_CHATS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}

async function apiGetMessages(chatId: string): Promise<StoredMessage[]> {
  try {
    const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Cache in localStorage
    try {
      localStorage.setItem(`${LOCAL_MSGS_PREFIX}${chatId}`, JSON.stringify(data.messages));
    } catch {}
    return data.messages;
  } catch {
    // Fallback to localStorage cache
    try {
      const raw = localStorage.getItem(`${LOCAL_MSGS_PREFIX}${chatId}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}

async function apiUpsertChat(chat: StoredChat): Promise<void> {
  try {
    // Optimistic localStorage update
    const cached = getStoredChatsSync();
    const idx = cached.findIndex((c) => c.id === chat.id);
    if (idx >= 0) {
      cached[idx] = { ...cached[idx], ...chat };
    } else {
      cached.unshift(chat);
    }
    syncSetChats(cached);

    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    console.warn("[chat-storage] Failed to upsert chat to SQLite:", chat.id);
  }
}

async function apiDeleteChat(chatId: string): Promise<void> {
  try {
    // Optimistic localStorage update
    const cached = getStoredChatsSync().filter((c) => c.id !== chatId);
    syncSetChats(cached);
    syncRemoveMessages(chatId);

    const res = await fetch("/api/chats", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    console.warn("[chat-storage] Failed to delete chat from SQLite:", chatId);
  }
}

async function apiAppendMessage(chatId: string, message: StoredMessage): Promise<void> {
  try {
    // Optimistic localStorage update
    const cached = getStoredMessagesSync(chatId);
    const idx = cached.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      cached[idx] = message;
    } else {
      cached.push(message);
    }
    syncSetMessages(chatId, cached);

    const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    console.warn("[chat-storage] Failed to append message to SQLite:", message.id);
  }
}

async function apiSetMessages(chatId: string, messages: StoredMessage[]): Promise<void> {
  try {
    // Optimistic localStorage update
    syncSetMessages(chatId, messages);

    const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    console.warn("[chat-storage] Failed to set messages to SQLite:", chatId);
  }
}

// ── Sync helpers (localStorage cache) ───────────────────────────────────

function getStoredChatsSync(): StoredChat[] {
  try {
    const raw = localStorage.getItem(LOCAL_CHATS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function syncSetChats(chats: StoredChat[]): void {
  try {
    localStorage.setItem(LOCAL_CHATS_KEY, JSON.stringify(chats));
  } catch {}
}

function getStoredMessagesSync(chatId: string): StoredMessage[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_MSGS_PREFIX}${chatId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function syncSetMessages(chatId: string, messages: StoredMessage[]): void {
  try {
    localStorage.setItem(`${LOCAL_MSGS_PREFIX}${chatId}`, JSON.stringify(messages));
  } catch (e) {
    console.error("[chat-storage] Failed to serialize messages for localStorage:", e);
  }
}

function syncRemoveMessages(chatId: string): void {
  try {
    localStorage.removeItem(`${LOCAL_MSGS_PREFIX}${chatId}`);
  } catch {}
}

// ── Public API (synchronous, localStorage-first, SQLite-backed) ─────────
// Functions must remain synchronous for compatibility with MockConvexClient
// They read from localStorage cache (kept in sync by API calls) and
// trigger async writes to SQLite in the background.

export function getStoredChats(): StoredChat[] {
  return getStoredChatsSync();
}

export function upsertStoredChat(chat: StoredChat): void {
  // Optimistic localStorage + async SQLite
  const chats = getStoredChatsSync();
  const idx = chats.findIndex((c) => c.id === chat.id);
  if (idx >= 0) {
    chats[idx] = { ...chats[idx], ...chat };
  } else {
    chats.unshift(chat);
  }
  syncSetChats(chats);
  apiUpsertChat(chat);
}

export function getStoredMessages(chatId: string): StoredMessage[] {
  return getStoredMessagesSync(chatId);
}

export function setStoredMessages(chatId: string, messages: StoredMessage[]): void {
  syncSetMessages(chatId, messages);
  apiSetMessages(chatId, messages);
}

export function appendStoredMessage(chatId: string, message: StoredMessage): void {
  const messages = getStoredMessagesSync(chatId);
  const idx = messages.findIndex((m) => m.id === message.id);
  if (idx >= 0) {
    messages[idx] = message;
  } else {
    messages.push(message);
  }
  syncSetMessages(chatId, messages);
  apiAppendMessage(chatId, message);
  // Auto-create chat entry if it doesn't exist (needed for sidebar)
  const chats = getStoredChatsSync();
  if (!chats.find((c) => c.id === chatId)) {
    upsertStoredChat({
      _id: chatId,
      id: chatId,
      title: "New Chat",
      update_time: Date.now(),
    });
  }
}

export function deleteStoredChat(chatId: string): void {
  const chats = getStoredChatsSync();
  syncSetChats(chats.filter((c) => c.id !== chatId));
  syncRemoveMessages(chatId);
  apiDeleteChat(chatId);
}
