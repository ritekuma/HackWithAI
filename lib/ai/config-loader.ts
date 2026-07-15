/**
 * config-loader.ts
 *
 * Loads `config/models.json` at module init and exposes:
 *   - MODELS_CONFIG      → full typed config (providers, tiers, agents, debate, auto)
 *   - TIER_MODEL_MAP     → flat Record<string,string> matching the old hardcoded map shape
 *   - getModelFor(key)   → helper with fallback resolution
 *   - getAgentFleet()    → typed AGENT_FLEET for UI (replaces the old const in providers.ts)
 *   - getDebateRounds()  → for lib/missions/debate.ts
 *   - classifyAutoMode() → for Auto Mode intent routing
 *
 * Future-proofing: when DeepSeek V5 / Claude 5 / Gemini 3 release, edit ONLY
 * config/models.json. No code changes needed.
 */

import fs from "node:fs";
import path from "node:path";
import { consoleLogger as logger } from "@/lib/console-logger";

// ── Types ────────────────────────────────────────────────────────────────
export interface ModelEntry {
  model: string;
  useCases?: string[];
  role?: string;
  label?: string;
  patterns?: string[];
}

export interface ModelsConfig {
  version: string;
  lastUpdated: string;
  providers: Record<string, { enabled: boolean; role: string; note: string }>;
  global: {
    vision: ModelEntry;
    longContext: ModelEntry;
    critic: ModelEntry;
  };
  tiers: Record<
    "standard" | "pro" | "max" | "enterprise",
    {
      label: string;
      primary: ModelEntry;
      fallback?: ModelEntry;
      secondary?: ModelEntry;
    }
  >;
  agents: Record<string, ModelEntry>;
  agentFleet: Array<{ key: string; model: string; role: string }>;
  debateEngine: {
    enabled: boolean;
    rounds: Array<{ step: number; agent: string; model: string; task: string }>;
  };
  autoMode: {
    enabled: boolean;
    description: string;
    rules: Array<{ intent: string; patterns: string[]; model: string }>;
  };
  tierKeys: Record<string, string>;
}

export type AgentFleet = Array<{ key: string; model: string; role: string }>;

// ── Loader ───────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(process.cwd(), "config", "models.json");

let _config: ModelsConfig | null = null;

function loadConfig(): ModelsConfig {
  if (_config) return _config;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as ModelsConfig;
    // Light validation
    if (!parsed.tierKeys || !parsed.agents || !parsed.tiers) {
      throw new Error("models.json missing required sections (tierKeys/agents/tiers)");
    }
    _config = parsed;
    logger.log(`[config-loader] models.json v${parsed.version} loaded (${Object.keys(parsed.tierKeys).length} tierKeys, ${parsed.agentFleet.length} agents)`);
    return _config;
  } catch (err) {
    logger.error("[config-loader] Failed to load models.json:", err);
    // Return a minimal emergency config so the app still boots
    _config = {
      version: "0.0.0",
      lastUpdated: "emergency-fallback",
      providers: { openrouter: { enabled: true, role: "primary", note: "emergency" } },
      global: {
        vision: { model: "google/gemini-2.5-flash" },
        longContext: { model: "moonshotai/kimi-k2.6" },
        critic: { model: "x-ai/grok-4" },
      },
      tiers: {
        standard: { label: "Standard", primary: { model: "deepseek/deepseek-v4-pro" }, fallback: { model: "deepseek/deepseek-v4-flash" } },
        pro:      { label: "Pro",      primary: { model: "anthropic/claude-sonnet-4.6" } },
        max:      { label: "Max",      primary: { model: "anthropic/claude-opus-4.6" } },
        enterprise: { label: "Enterprise", primary: { model: "nousresearch/hermes-3-llama-3.1-405b" }, secondary: { model: "qwen/qwen-2.5-coder-32b-instruct" } },
      },
      agents: {},
      agentFleet: [],
      debateEngine: { enabled: false, rounds: [] },
      autoMode: { enabled: false, description: "", rules: [] },
      tierKeys: {
        "ask-model": "deepseek/deepseek-chat",
        "agent-model": "nousresearch/hermes-3-llama-3.1-405b",
        "model-vision": "google/gemini-2.5-flash",
        "model-helper": "deepseek/deepseek-v4-flash",
        "title-generator-model": "deepseek/deepseek-v4-flash",
        "fallback-agent-model": "deepseek/deepseek-v4-pro",
        "fallback-ask-model": "deepseek/deepseek-v4-pro",
        "final-review-model": "google/gemini-2.5-flash",
      },
    };
    return _config;
  }
}

// ── Public API ───────────────────────────────────────────────────────────
export const MODELS_CONFIG: ModelsConfig = loadConfig();

/** Flat string→string map for backwards compat with old TIER_MAP shape. */
export const TIER_MODEL_MAP: Record<string, string> = MODELS_CONFIG.tierKeys;

/** Look up a model by key, with optional fallback chain. */
export function getModelFor(key: string, ...fallbackKeys: string[]): string {
  const all = [key, ...fallbackKeys];
  for (const k of all) {
    const m = TIER_MODEL_MAP[k];
    if (m) return m;
  }
  return TIER_MODEL_MAP["fallback-ask-model"] ?? "deepseek/deepseek-v4-pro";
}

/** Get the full agent fleet for the UI (was AGENT_FLEET in providers.ts). */
export function getAgentFleet(): AgentFleet {
  return MODELS_CONFIG.agentFleet;
}

/** Get debate engine rounds for the debate pipeline. */
export function getDebateRounds() {
  return MODELS_CONFIG.debateEngine.rounds;
}

/** Get auto-mode intent rules. */
export function getAutoModeRules() {
  return MODELS_CONFIG.autoMode.rules;
}

/**
 * Auto Mode classifier. Given a user prompt, return the best-fit model ID.
 * Returns the "default" rule's model if no pattern matches.
 */
export function classifyAutoMode(prompt: string): { intent: string; model: string } {
  const p = prompt.toLowerCase();
  for (const rule of MODELS_CONFIG.autoMode.rules) {
    if (rule.intent === "default") continue;
    if (rule.patterns.some((pat) => p.includes(pat.toLowerCase()))) {
      return { intent: rule.intent, model: rule.model };
    }
  }
  const def = MODELS_CONFIG.autoMode.rules.find((r) => r.intent === "default");
  return { intent: "default", model: def?.model ?? TIER_MODEL_MAP["fallback-ask-model"] };
}

/** Resolve a tier label ("standard" | "pro" | "max" | "enterprise") to its primary model. */
export function getTierPrimaryModel(tier: keyof ModelsConfig["tiers"]): string {
  return MODELS_CONFIG.tiers[tier]?.primary?.model ?? TIER_MODEL_MAP["fallback-ask-model"];
}

/** Hot-reload (call after editing models.json to clear cache). */
export function reloadModelsConfig(): ModelsConfig {
  _config = null;
  return loadConfig();
}

