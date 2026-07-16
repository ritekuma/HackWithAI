// ── Execution Mode Lock ──
// Strict LOCAL / CLOUD separation. Mode persists across restarts.
// Never auto-switches. Explicit user confirmation required for changes.

// ── Types ─────────────────────────────────────────────────────────────

export type ExecutionMode = "local" | "cloud";

export interface ExecutionConfig {
  mode: ExecutionMode;
  chatProvider: string;       // e.g. "openrouter", "google", "ollama"
  executionProvider: string;   // e.g. "local-machine", "e2b", "desktop"
  workspace: string;           // e.g. "/home/kali/HackWithAI"
  chatModel: string;           // e.g. "model-vision", "model-standard-fallback"
}

// ── Storage keys ──────────────────────────────────────────────────────

const STORAGE_KEY = "hwai_execution_mode";

// ── In-memory cache ───────────────────────────────────────────────────

let _cachedMode: ExecutionMode | null = null;
let _cachedConfig: ExecutionConfig | null = null;

// ── Detection ──────────────────────────────────────────────────────────

function detectDefaultMode(): ExecutionMode {
  if (process.env.LOCAL_ONLY_MODE === "true") return "local";
  if (process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE === "true") return "local";
  return "cloud";
}

function detectChatProvider(): string {
  return process.env.PROVIDER_MODE || process.env.NEXT_PUBLIC_PROVIDER_MODE || "openrouter";
}

function detectWorkspace(): string {
  if (typeof process !== "undefined" && process.cwd) return process.cwd();
  return "/home/kali/HackWithAI";
}

function detectExecutionProvider(): string {
  if (detectDefaultMode() === "local") return "local-machine";
  return process.env.SANDBOX_TYPE || "e2b";
}

// ── Browser-side storage ──────────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredMode(): ExecutionMode | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "local" || raw === "cloud") return raw;
  } catch {}
  return null;
}

function writeStoredMode(mode: ExecutionMode): void {
  if (!isBrowser()) return;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
}

// ── API ───────────────────────────────────────────────────────────────

export function getExecutionMode(): ExecutionMode {
  if (_cachedMode) return _cachedMode;

  // 1. Stored preference (survives restarts)
  const stored = readStoredMode();
  if (stored) {
    _cachedMode = stored;
    return stored;
  }

  // 2. Environment default
  _cachedMode = detectDefaultMode();
  return _cachedMode;
}

export function setExecutionMode(mode: ExecutionMode): void {
  if (_cachedMode === mode) return;
  _cachedMode = mode;
  writeStoredMode(mode);
}

export function isLocalMode(): boolean {
  return getExecutionMode() === "local";
}

export function isCloudMode(): boolean {
  return getExecutionMode() === "cloud";
}

export function getExecutionConfig(): ExecutionConfig {
  if (_cachedConfig) return _cachedConfig;

  const mode = getExecutionMode();
  _cachedConfig = {
    mode,
    chatProvider: detectChatProvider(),
    executionProvider: detectExecutionProvider(),
    workspace: detectWorkspace(),
    chatModel: mode === "local" ? "model-standard-fallback" : "model-standard-chat",
  };
  return _cachedConfig;
}

/**
 * Switch execution mode WITH explicit confirmation.
 * Never call this automatically — only from user action.
 */
export function switchMode(newMode: ExecutionMode): ExecutionConfig {
  setExecutionMode(newMode);
  _cachedConfig = null; // force rebuild
  return getExecutionConfig();
}

/**
 * Returns true if the current mode differs from what was persisted,
 * meaning the user needs to confirm mode restoration.
 */
export function modeWasReset(): boolean {
  const stored = readStoredMode();
  if (!stored) return false;
  return stored !== detectDefaultMode();
}

/**
 * Restore mode after crash/restart. Returns the restored config
 * or null if no stored mode exists.
 */
export function restoreMode(): ExecutionConfig | null {
  const stored = readStoredMode();
  if (!stored) return null;
  setExecutionMode(stored);
  _cachedConfig = null;
  return getExecutionConfig();
}
