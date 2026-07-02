import { customProvider } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOllama } from "ollama-ai-provider";
import type { ChatMode, SelectedModel } from "@/types/chat";
import { isAgentMode } from "@/lib/utils/mode-helpers";
import { openrouterAttributionHeaders } from "@/lib/ai/openrouter-attribution";
// import { withTracing } from "@posthog/ai";
// import PostHogClient from "@/app/posthog";
// import type { SubscriptionTier } from "@/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isXaiModelSlug = (value: unknown): boolean =>
  typeof value === "string" && value.toLowerCase().startsWith("x-ai/");

const isGeminiModelSlug = (value: unknown): boolean =>
  typeof value === "string" && value.toLowerCase().startsWith("google/gemini");

const requestCanRouteToXai = (body: unknown): boolean => {
  if (!isRecord(body)) return false;
  if (isXaiModelSlug(body.model)) return true;
  return Array.isArray(body.models) && body.models.some(isXaiModelSlug);
};

const requestCanRouteToGemini = (body: unknown): boolean => {
  if (!isRecord(body)) return false;
  if (isGeminiModelSlug(body.model)) return true;
  return Array.isArray(body.models) && body.models.some(isGeminiModelSlug);
};

const hasOwnEncryptedContent = (value: unknown): boolean =>
  isRecord(value) && Object.hasOwn(value, "encrypted_content");

const stripEncryptedContent = (
  value: unknown,
  inReasoningDetails = false,
): { value: unknown; changed: boolean } => {
  if (Array.isArray(value)) {
    let changed = false;
    const cleaned: unknown[] = [];

    for (const item of value) {
      if (inReasoningDetails && hasOwnEncryptedContent(item)) {
        changed = true;
        continue;
      }
      const result = stripEncryptedContent(item, inReasoningDetails);
      changed ||= result.changed;
      cleaned.push(result.value);
    }

    return changed ? { value: cleaned, changed } : { value, changed: false };
  }

  if (!isRecord(value)) {
    return { value, changed: false };
  }

  let changed = false;
  const cleaned: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(value)) {
    if (inReasoningDetails && key === "encrypted_content") {
      changed = true;
      continue;
    }

    const nextInReasoningDetails =
      inReasoningDetails || key === "reasoning_details";
    const result = stripEncryptedContent(entryValue, nextInReasoningDetails);
    changed ||= result.changed;

    if (
      key === "reasoning_details" &&
      Array.isArray(result.value) &&
      result.value.length === 0
    ) {
      changed = true;
      continue;
    }

    cleaned[key] = result.value;
  }

  return changed ? { value: cleaned, changed } : { value, changed: false };
};

const patchKimiReasoningToolCalls = (
  body: unknown,
): { body: unknown; changed: boolean } => {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return { body, changed: false };
  }

  let changed = false;
  const messages = body.messages.map((message: unknown) => {
    if (!isRecord(message)) return message;
    if (message.role !== "assistant") return message;
    if (!Array.isArray(message.tool_calls)) return message;

    const hasReasoningContent =
      typeof message.reasoning_content === "string" &&
      message.reasoning_content.length > 0;

    const hasReasoning =
      typeof message.reasoning === "string" && message.reasoning.length > 0;

    if (!hasReasoningContent && !hasReasoning) {
      changed = true;
      return { ...message, reasoning: "." };
    }
    return message;
  });

  return changed
    ? { body: { ...body, messages }, changed: true }
    : { body, changed: false };
};

export const sanitizeOpenRouterRequestForXai = (
  body: unknown,
): { body: unknown; changed: boolean } => {
  if (!requestCanRouteToXai(body)) return { body, changed: false };

  const { value, changed } = stripEncryptedContent(body);
  return { body: value, changed };
};

const hasOpenApiRef = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasOpenApiRef);
  if (!isRecord(value)) return false;
  if (typeof value.$ref === "string") return true;
  return Object.values(value).some(hasOpenApiRef);
};

export const sanitizeOpenRouterRequestForGeminiFunctionResponses = (
  body: unknown,
): { body: unknown; changed: boolean } => {
  if (!requestCanRouteToGemini(body)) return { body, changed: false };
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return { body, changed: false };
  }

  let changed = false;
  const messages = (body.messages as unknown[]).map((message: unknown) => {
    if (!isRecord(message) || message.role !== "tool") return message;

    if (typeof message.content === "string") {
      try {
        const parsedContent = JSON.parse(message.content) as unknown;
        if (!hasOpenApiRef(parsedContent)) return message;
        changed = true;
        return {
          ...message,
          content: JSON.stringify({ result: message.content }),
        };
      } catch {
        return message;
      }
    }

    if (!Array.isArray(message.content)) return message;

    const newContent = message.content.map((item: unknown) => {
      if (!isRecord(item) || !isRecord(item.response)) return item;
      if (typeof item.response.$ref !== "string") return item;

      changed = true;
      return {
        ...item,
        response: JSON.stringify(item.response),
      };
    });

    return { ...message, content: newContent };
  });

  return changed
    ? { body: { ...body, messages }, changed: true }
    : { body, changed: false };
};

const OPENROUTER_METADATA_HEADER = "X-OpenRouter-Experimental-Metadata";

const withOpenRouterMetadataHeader = (
  headers: HeadersInit | undefined,
): Headers => {
  const nextHeaders = new Headers(headers);
  if (!nextHeaders.has(OPENROUTER_METADATA_HEADER)) {
    nextHeaders.set(OPENROUTER_METADATA_HEADER, "enabled");
  }
  return nextHeaders;
};

const openrouterPatchFetch: typeof fetch = async (url, init) => {
  let nextInit: RequestInit = {
    ...init,
    headers: withOpenRouterMetadataHeader(init?.headers),
  };

  if (nextInit.body && typeof nextInit.body === "string") {
    try {
      const parsedBody = JSON.parse(nextInit.body) as unknown;
      const kimiPatched = patchKimiReasoningToolCalls(parsedBody);
      const xaiPatched = sanitizeOpenRouterRequestForXai(kimiPatched.body);
      const geminiPatched = sanitizeOpenRouterRequestForGeminiFunctionResponses(
        xaiPatched.body,
      );
      if (kimiPatched.changed || xaiPatched.changed || geminiPatched.changed) {
        nextInit = { ...nextInit, body: JSON.stringify(geminiPatched.body) };
      }
    } catch {
      // If parsing fails, send the request as-is
    }
  }

  // Route through SOCKS5 proxy if configured (Tor anonymity)
  const proxyUrl = process.env.HWAI_PROXY || process.env.http_proxy;
  if (proxyUrl) {
    try {
      const { ProxyAgent } = await import("undici");
      (nextInit as Record<string, unknown>).dispatcher = new ProxyAgent(proxyUrl);
    } catch {
      // undici not available — proceed direct
    }
  }

  return globalThis.fetch(url, nextInit);
};

// ============================================================================
// Provider Mode Configuration
// ============================================================================
export type ProviderMode =
  | "openrouter"
  | "openai"
  | "google"
  | "anthropic"
  | "ollama";

export const getProviderMode = (): ProviderMode => {
  const mode = process.env.PROVIDER_MODE as ProviderMode | undefined;
  if (
    mode &&
    ["openrouter", "openai", "google", "anthropic", "ollama"].includes(mode)
  ) {
    return mode;
  }
  return "openrouter";
};

export const isLocalMode = (): boolean => getProviderMode() === "ollama";
export const isCloudMode = (): boolean => !isLocalMode();

// ============================================================================
// Provider Factory
// ============================================================================
const openrouter = createOpenRouter({
  fetch: openrouterPatchFetch,
  headers: openrouterAttributionHeaders,
});

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const google = createGoogleGenerativeAI({
  apiKey:
    process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const ollama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/api",
});

type OpenRouterInstance = typeof openrouter;

// ============================================================================
// Model Maps per Provider
// ============================================================================
const buildOpenRouterMap = (or: OpenRouterInstance) => ({
  // ── Auto-router models ──
  "ask-model": or("deepseek/deepseek-chat"),
  "ask-model-free": or("deepseek/deepseek-v4-pro"),
  "agent-model": or("nousresearch/hermes-3-llama-3.1-405b"),
  "agent-model-free": or("deepseek/deepseek-v4-pro"),

  // ── Standard (DeepSeek V4 Pro core) ──
  "model-standard-chat": or("deepseek/deepseek-v4-pro"),
  "model-standard-code": or("deepseek/deepseek-v4-pro"),
  "model-standard-research": or("moonshotai/kimi-k2.6"),
  "model-standard-vision": or("google/gemini-2.5-flash"),
  "model-standard-critic": or("x-ai/grok-4"),
  "model-standard-title": or("deepseek/deepseek-v4-flash"),
  "model-standard-fallback": or("deepseek/deepseek-v4-flash"),

  // ── Pro (Claude Sonnet 4.6 core) ──
  "model-pro-chat": or("anthropic/claude-sonnet-4.6"),
  "model-pro-code": or("anthropic/claude-sonnet-4.6"),
  "model-pro-research": or("moonshotai/kimi-k2.6"),
  "model-pro-vision": or("google/gemini-2.5-flash"),
  "model-pro-critic": or("x-ai/grok-4"),
  "model-pro-title": or("deepseek/deepseek-v4-flash"),
  "model-pro-fallback": or("deepseek/deepseek-chat"),

  // ── Max (Claude Opus 4.6 core) ──
  "model-max-chat": or("anthropic/claude-opus-4.6"),
  "model-max-arch": or("anthropic/claude-opus-4.6"),
  "model-max-research": or("moonshotai/kimi-k2.6"),
  "model-max-vision": or("google/gemini-2.5-flash"),
  "model-max-critic": or("x-ai/grok-4"),
  "model-max-title": or("deepseek/deepseek-v4-flash"),
  "model-max-fallback": or("anthropic/claude-sonnet-4.6"),

  // ── Enterprise (Hermes 405B planning + Qwen coding) ──
  "model-enterprise-plan": or("nousresearch/hermes-3-llama-3.1-405b"),
  "model-enterprise-code": or("qwen/qwen-2.5-coder-32b-instruct"),
  "model-enterprise-research": or("moonshotai/kimi-k2.6"),
  "model-enterprise-vision": or("google/gemini-2.5-flash"),
  "model-enterprise-critic": or("x-ai/grok-4"),
  "model-enterprise-title": or("deepseek/deepseek-v4-flash"),
  "model-enterprise-fallback": or("deepseek/deepseek-v4-flash"),

  // ── Agent assignments ──
  "agent-planner": or("nousresearch/hermes-3-llama-3.1-405b"),
  "agent-researcher": or("moonshotai/kimi-k2.6"),
  "agent-coder": or("qwen/qwen-2.5-coder-32b-instruct"),
  "agent-reviewer": or("anthropic/claude-sonnet-4.6"),
  "agent-critic": or("x-ai/grok-4"),
  "agent-debate": or("x-ai/grok-4"),
  "agent-optimizer": or("deepseek/deepseek-v4-flash"),
  "agent-self-improve": or("deepseek/deepseek-v4-flash"),
  "agent-coordinator": or("nousresearch/hermes-3-llama-3.1-405b"),

  // ── Global specialists ──
  "model-vision": or("google/gemini-2.5-flash"),
  "model-kimi": or("moonshotai/kimi-k2.6"),
  "model-grok": or("x-ai/grok-4"),
  "model-qwen-code": or("qwen/qwen-2.5-coder-32b-instruct"),
  "model-hermes-plan": or("nousresearch/hermes-3-llama-3.1-405b"),

  // ── Helpers ──
  "model-helper": or("deepseek/deepseek-v4-flash"),
  "title-generator-model": or("deepseek/deepseek-v4-flash"),

  // ── Fallbacks ──
  "fallback-agent-model": or("deepseek/deepseek-v4-pro"),
  "fallback-ask-model": or("deepseek/deepseek-v4-pro"),
  "final-review-model": or("google/gemini-2.5-flash"),
});

const buildOpenAIMap = () => ({
  "ask-model": openai("gpt-4o"),
  "ask-model-free": openai("gpt-4o-mini"),
  "agent-model": openai("gpt-4.5-preview"),
  "agent-model-free": openai("gpt-4o-mini"),
  "model-standard-chat": openai("gpt-4o-mini"), "model-standard-code": openai("gpt-4o-mini"), "model-standard-research": openai("gpt-4o"), "model-standard-vision": openai("gpt-4o"), "model-standard-critic": openai("gpt-4o"), "model-standard-title": openai("gpt-4o-mini"), "model-standard-fallback": openai("gpt-4o-mini"),
  "model-pro-chat": openai("gpt-4o"), "model-pro-code": openai("gpt-4.5-preview"), "model-pro-research": openai("gpt-4o"), "model-pro-vision": openai("gpt-4o"), "model-pro-critic": openai("gpt-4o"), "model-pro-title": openai("gpt-4o-mini"), "model-pro-fallback": openai("gpt-4o"),
  "model-max-chat": openai("gpt-4.5-preview"), "model-max-arch": openai("gpt-4.5-preview"), "model-max-research": openai("gpt-4o"), "model-max-vision": openai("gpt-4o"), "model-max-critic": openai("gpt-4o"), "model-max-title": openai("gpt-4o-mini"), "model-max-fallback": openai("gpt-4o"),
  "model-enterprise-plan": openai("gpt-4.5-preview"), "model-enterprise-code": openai("gpt-4o"), "model-enterprise-research": openai("gpt-4o"), "model-enterprise-vision": openai("gpt-4o"), "model-enterprise-critic": openai("gpt-4o"), "model-enterprise-title": openai("gpt-4o-mini"), "model-enterprise-fallback": openai("gpt-4o-mini"),
  "agent-planner": openai("gpt-4.5-preview"), "agent-researcher": openai("gpt-4o"), "agent-coder": openai("gpt-4o"), "agent-reviewer": openai("gpt-4.5-preview"), "agent-critic": openai("gpt-4o"), "agent-debate": openai("gpt-4o"), "agent-optimizer": openai("gpt-4o-mini"), "agent-self-improve": openai("gpt-4o-mini"), "agent-coordinator": openai("gpt-4.5-preview"),
  "model-vision": openai("gpt-4o"), "model-kimi": openai("gpt-4o-mini"), "model-grok": openai("gpt-4o"), "model-qwen-code": openai("gpt-4o"), "model-hermes-plan": openai("gpt-4.5-preview"),
  "model-helper": openai("gpt-4o-mini"), "title-generator-model": openai("gpt-4o-mini"),
  "fallback-agent-model": openai("gpt-4o"), "fallback-ask-model": openai("gpt-4o"),
  "final-review-model": openai("gpt-4o"),
});

const buildGoogleMap = () => ({
  "ask-model": google("gemini-2.5-flash-preview-05-20"),
  "ask-model-free": google("gemini-2.5-flash-preview-05-20"),
  "agent-model": google("gemini-2.5-pro-preview-05-06"),
  "agent-model-free": google("gemini-2.5-flash-preview-05-20"),
  "model-standard-chat": google("gemini-2.5-flash-preview-05-20"),
  "model-standard-vision": google("gemini-2.5-flash-preview-05-20"),
  "model-standard-fallback": google("gemini-2.5-flash-preview-05-20"),
  "model-pro-chat": google("gemini-2.5-pro-preview-05-06"),
  "model-pro-fallback": google("gemini-2.5-flash-preview-05-20"),
  "model-max-chat": google("gemini-2.5-pro-preview-05-06"),
  "model-max-fallback": google("gemini-2.5-pro-preview-05-06"),
  "model-enterprise-plan": google("gemini-2.5-pro-preview-05-06"),
  "model-enterprise-code": google("gemini-2.5-flash-preview-05-20"),
  "model-enterprise-fallback": google("gemini-2.5-flash-preview-05-20"),
  "model-vision": google("gemini-2.5-flash-preview-05-20"),
  "model-kimi": google("gemini-2.5-flash-preview-05-20"),
  "model-grok": google("gemini-2.5-pro-preview-05-06"),
  "model-helper": google("gemini-2.5-flash-preview-05-20"),
  "title-generator-model": google("gemini-2.5-flash-preview-05-20"),
  "fallback-agent-model": google("gemini-2.5-flash-preview-05-20"),
  "fallback-ask-model": google("gemini-2.5-flash-preview-05-20"),
  "final-review-model": google("gemini-2.5-flash-preview-05-20"),
});

const buildAnthropicMap = () => ({
  "ask-model": anthropic("claude-sonnet-4-20250514"),
  "ask-model-free": anthropic("claude-sonnet-4-20250514"),
  "agent-model": anthropic("claude-sonnet-4-20250514"),
  "agent-model-free": anthropic("claude-sonnet-4-20250514"),
  "model-standard-chat": anthropic("claude-sonnet-4-20250514"),
  "model-standard-vision": anthropic("claude-sonnet-4-20250514"),
  "model-standard-fallback": anthropic("claude-sonnet-4-20250514"),
  "model-pro-chat": anthropic("claude-sonnet-4-20250514"),
  "model-pro-fallback": anthropic("claude-sonnet-4-20250514"),
  "model-max-chat": anthropic("claude-opus-4-20250514"),
  "model-max-fallback": anthropic("claude-sonnet-4-20250514"),
  "model-enterprise-plan": anthropic("claude-sonnet-4-20250514"),
  "model-enterprise-code": anthropic("claude-sonnet-4-20250514"),
  "model-enterprise-fallback": anthropic("claude-sonnet-4-20250514"),
  "model-vision": anthropic("claude-sonnet-4-20250514"),
  "model-kimi": anthropic("claude-sonnet-4-20250514"),
  "model-grok": anthropic("claude-sonnet-4-20250514"),
  "model-helper": anthropic("claude-sonnet-4-20250514"),
  "title-generator-model": anthropic("claude-sonnet-4-20250514"),
  "fallback-agent-model": anthropic("claude-sonnet-4-20250514"),
  "fallback-ask-model": anthropic("claude-sonnet-4-20250514"),
  "final-review-model": anthropic("claude-sonnet-4-20250514"),
});

const buildOllamaMap = () => {
  const models: Record<string, any> = {
    "ask-model": ollama("qwen2.5-coder"),
    "ask-model-free": ollama("qwen2.5-coder"),
    "agent-model": ollama("qwen2.5-coder"),
    "agent-model-free": ollama("qwen2.5-coder"),
    "model-standard-chat": ollama("qwen2.5-coder"),
    "model-standard-vision": ollama("qwen2.5-coder"),
    "model-standard-fallback": ollama("qwen2.5-coder"),
    "model-pro-chat": ollama("qwen2.5-coder"),
    "model-pro-fallback": ollama("qwen2.5-coder"),
    "model-max-chat": ollama("qwen2.5-coder"),
    "model-max-fallback": ollama("qwen2.5-coder"),
    "model-enterprise-plan": ollama("qwen2.5-coder"),
    "model-enterprise-code": ollama("qwen2.5-coder"),
    "model-enterprise-fallback": ollama("qwen2.5-coder"),
    "model-vision": ollama("qwen2.5-coder"),
    "model-kimi": ollama("qwen2.5-coder"),
    "model-grok": ollama("qwen2.5-coder"),
    "model-helper": ollama("qwen2.5-coder"),
    "title-generator-model": ollama("qwen2.5-coder"),
    "fallback-agent-model": ollama("qwen2.5-coder"),
    "fallback-ask-model": ollama("qwen2.5-coder"),
    "final-review-model": ollama("qwen2.5-coder"),
    // Local-specific aliases
    "ollama-qwen": ollama("qwen2.5-coder"),
    "ollama-deepseek": ollama("deepseek-coder:6.7b"),
    "ollama-mistral": ollama("mistral"),
    "ollama-llama": ollama("llama3.1"),
  };
  return models;
};

const buildProviderMap = () => {
  const mode = getProviderMode();
  switch (mode) {
    case "openai":
      return buildOpenAIMap();
    case "google":
      return buildGoogleMap();
    case "anthropic":
      return buildAnthropicMap();
    case "ollama":
      return buildOllamaMap();
    case "openrouter":
    default:
      return buildOpenRouterMap(openrouter);
  }
};

const baseProviders = buildProviderMap();

export type ModelName = keyof typeof baseProviders;

export const modelCutoffDates: Record<ModelName, string> &
  Record<string, string> = {
  "ask-model": "January 2025",
  "ask-model-free": "May 2025",
  "agent-model": "April 2024",
  "agent-model-free": "April 2024",
  "model-standard-chat": "May 2025",
  "model-standard-vision": "January 2025",
  "model-standard-fallback": "May 2025",
  "model-pro-chat": "May 2025",
  "model-pro-fallback": "February 2025",
  "model-max-chat": "May 2025",
  "model-max-fallback": "May 2025",
  "model-enterprise-plan": "January 2025",
  "model-enterprise-code": "January 2025",
  "model-enterprise-fallback": "May 2025",
  "model-vision": "January 2025",
  "model-kimi": "April 2024",
  "model-grok": "December 2025",
  "model-helper": "May 2025",
  "title-generator-model": "January 2025",
  "fallback-agent-model": "January 2025",
  "fallback-ask-model": "January 2025",
  "final-review-model": "January 2025",
  "ollama-qwen": "May 2025",
  "ollama-deepseek": "May 2025",
  "ollama-mistral": "May 2025",
  "ollama-llama": "May 2025",
};

export const modelDisplayNames: Record<ModelName, string> &
  Record<string, string> = {
  "ask-model":
    "Auto, an intelligent model router built by HackWithAI v2",
  "ask-model-free":
    "Auto, an intelligent model router built by HackWithAI v2",
  "agent-model":
    "Auto, an intelligent model router built by HackWithAI v2",
  "agent-model-free":
    "Auto, an intelligent model router built by HackWithAI v2",
  "model-standard-chat": "DeepSeek V4 Pro",
  "model-standard-vision": "Gemini 2.5 Flash — Vision",
  "model-standard-fallback": "DeepSeek V4 Flash — Standard Fallback",
  "model-pro-chat": "Claude Sonnet 4.6 — Professional Engineering",
  "model-pro-fallback": "DeepSeek Chat — Pro Fallback",
  "model-max-chat": "Claude Opus 4.6 — Maximum Intelligence",
  "model-max-fallback": "Claude Sonnet 4.6 — Max Fallback",
  "model-enterprise-plan": "Hermes 3 405B — Enterprise Planning & Coordination",
  "model-enterprise-code": "Qwen 2.5 Coder 32B — Enterprise Coding",
  "model-enterprise-fallback": "DeepSeek V4 Flash — Enterprise Fallback",
  "model-vision": "Gemini 2.5 Flash — Image & PDF Analysis",
  "model-kimi": "Moonshot Kimi K2.6 — Long-Context Specialist",
  "model-grok": "Grok 4 — Critic & Debate Engine",
  "model-helper": "DeepSeek V4 Flash — Helper Tasks",
  "title-generator-model": "DeepSeek V4 Flash — Title Generation",
  "fallback-agent-model":
    "Auto, an intelligent model router built by HackWithAI v2",
  "fallback-ask-model":
    "Auto, an intelligent model router built by HackWithAI v2",
  "final-review-model": "Claude Sonnet 4.6 — Final Review & Audit",
  "ollama-qwen": "Ollama - Qwen 2.5 Coder (Local)",
  "ollama-deepseek": "Ollama - DeepSeek Coder 6.7B (Local)",
  "ollama-mistral": "Ollama - Mistral (Local)",
  "ollama-llama": "Ollama - Llama 3.1 (Local)",
};

export const getModelDisplayName = (modelName: ModelName): string => {
  return modelDisplayNames[modelName];
};

export const getModelCutoffDate = (modelName: ModelName): string => {
  return modelCutoffDates[modelName];
};

export function isAnthropicModel(modelName: string): boolean {
  return modelName.includes("sonnet") || modelName.includes("opus");
}

export function isDeepSeekModel(modelName: string): boolean {
  return (
    modelName === "ask-model-free" ||
    modelName === "agent-model-free" ||
    modelName === "model-standard-chat" ||
    modelName === "model-helper"
  );
}

export function supportsMultimodalToolResults(modelName?: string): boolean {
  if (!modelName) return false;

  const normalized = modelName.toLowerCase();

  return (
    normalized === "ask-model" ||
    normalized.includes("gemini") ||
    normalized.includes("google/") ||
    isAnthropicModel(normalized) ||
    normalized.includes("anthropic/") ||
    normalized.includes("claude") ||
    normalized.includes("openai/") ||
    normalized.includes("gpt-") ||
    normalized.includes("o1") ||
    normalized.includes("o3") ||
    normalized.includes("o4") ||
    normalized.includes("x-ai/") ||
    normalized.includes("grok") ||
    normalized.includes("ollama")
  );
}

export function isGeminiModel(modelName: string): boolean {
  return modelName === "ask-model" || modelName === "model-vision" || modelName === "model-standard-vision";
}

export function isOllamaModel(modelName: string): boolean {
  return modelName.startsWith("ollama-");
}

/**
 * Map a HackWithAI v2 tier id to the underlying provider key for a given mode.
 * Returns `null` for `"auto"` (the caller routes to the auto-router model
 * key instead). The Pro/Max tiers map to the same model in both modes; only
 * Standard differs.
 */
export function resolveTierToProviderKey(
  tier: SelectedModel,
  mode: ChatMode,
): ModelName | null {
  if (tier === "auto") return null;
  switch (tier) {
    case "hwai-standard":
      return "model-standard-chat";
    case "hwai-pro":
      return "model-pro-chat";
    case "hwai-max":
      return "model-max-chat";
    case "hwai-enterprise":
      return isAgentMode(mode) ? "model-enterprise-plan" : "model-enterprise-code";
  }
}

export const myProvider = customProvider({
  languageModels: baseProviders,
});

export const createTrackedProvider = () =>
  // userId?: string,
  // conversationId?: string,
  // subscription?: SubscriptionTier,
  // phClient?: ReturnType<typeof PostHogClient> | null,
  {
    // PostHog provider tracking disabled
    // if (!phClient || subscription === "free") {
    //   return myProvider;
    // }
    //
    // const trackedModels: Record<string, any> = {};
    //
    // Object.entries(baseProviders).forEach(([modelName, model]) => {
    //   trackedModels[modelName] = withTracing(model, phClient, {
    //     ...(userId && { posthogDistinctId: userId }),
    //     posthogProperties: {
    //       modelType: modelName,
    //       ...(conversationId && { conversationId }),
    //       subscriptionTier: subscription,
    //     },
    //     posthogPrivacyMode: true,
    //   });
    // });
    //
    // return customProvider({
    //   languageModels: trackedModels,
    // });

    return myProvider;
  };
