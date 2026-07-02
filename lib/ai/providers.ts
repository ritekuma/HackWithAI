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
  "ask-model": or("qwen/qwen-2.5-coder-32b-instruct"),
  "ask-model-free": or("qwen/qwen-2.5-coder-32b-instruct"),
  "agent-model": or("nousresearch/hermes-3-llama-3.1-405b"),
  "agent-model-free": or("nousresearch/hermes-3-llama-3.1-405b"),
  "model-sonnet-4.6": or("deepseek/deepseek-chat"),
  "model-gpt-4.5": or("deepseek/deepseek-chat"),
  "model-gemini-3-flash": or("google/gemini-2.5-flash"),
  "model-deepseek-v4-flash": or("deepseek/deepseek-v4-flash"),
  "model-opus-4.6": or("deepseek/deepseek-chat"),
  "model-kimi-k2.6": or("moonshotai/kimi-k2.6:exacto"),
  "fallback-agent-model": or("deepseek/deepseek-v4-flash"),
  "fallback-ask-model": or("deepseek/deepseek-v4-flash"),
  "fallback-gemini-3.5-flash": or("google/gemini-2.5-flash"),
  "fallback-grok-4.3": or("x-ai/grok-4.3"),
  "title-generator-model": or("deepseek/deepseek-v4-flash"),
  "final-review-model": or("google/gemini-2.5-flash"),
  "model-enterprise-planning": or("nousresearch/hermes-3-llama-3.1-405b"),
  "model-enterprise-coding": or("qwen/qwen-2.5-coder-32b-instruct"),
});

const buildOpenAIMap = () => ({
  "ask-model": openai("gpt-4o"),
  "ask-model-free": openai("gpt-4o-mini"),
  "agent-model": openai("gpt-4.5-preview"),
  "agent-model-free": openai("gpt-4o-mini"),
  "model-sonnet-4.6": openai("gpt-4o"),
  "model-gpt-4.5": openai("gpt-4.5-preview"),
  "model-gemini-3-flash": openai("gpt-4o-mini"),
  "model-deepseek-v4-flash": openai("gpt-4o-mini"),
  "model-opus-4.6": openai("gpt-4o"),
  "model-kimi-k2.6": openai("gpt-4o-mini"),
  "fallback-agent-model": openai("gpt-4o"),
  "fallback-ask-model": openai("gpt-4o"),
  "fallback-gemini-3.5-flash": openai("gpt-4o-mini"),
  "fallback-grok-4.3": openai("gpt-4o"),
  "title-generator-model": openai("gpt-4o-mini"),
  "final-review-model": openai("gpt-4o"),
  "model-enterprise-planning": openai("gpt-4o"),
  "model-enterprise-coding": openai("gpt-4o"),
});

const buildGoogleMap = () => ({
  "ask-model": google("gemini-2.5-flash-preview-05-20"),
  "ask-model-free": google("gemini-2.5-flash-preview-05-20"),
  "agent-model": google("gemini-2.5-pro-preview-05-06"),
  "agent-model-free": google("gemini-2.5-flash-preview-05-20"),
  "model-sonnet-4.6": google("gemini-2.5-pro-preview-05-06"),
  "model-gpt-4.5": google("gemini-2.5-pro-preview-05-06"),
  "model-gemini-3-flash": google("gemini-2.5-flash-preview-05-20"),
  "model-deepseek-v4-flash": google("gemini-2.5-flash-preview-05-20"),
  "model-opus-4.6": google("gemini-2.5-pro-preview-05-06"),
  "model-kimi-k2.6": google("gemini-2.5-pro-preview-05-06"),
  "fallback-agent-model": google("gemini-2.5-flash-preview-05-20"),
  "fallback-ask-model": google("gemini-2.5-flash-preview-05-20"),
  "fallback-gemini-3.5-flash": google("gemini-2.5-flash-preview-05-20"),
  "fallback-grok-4.3": google("gemini-2.5-pro-preview-05-06"),
  "title-generator-model": google("gemini-2.5-flash-preview-05-20"),
  "final-review-model": google("gemini-2.5-pro-preview-05-06"),
  "model-enterprise-planning": google("gemini-2.5-pro-preview-05-06"),
  "model-enterprise-coding": google("gemini-2.5-flash-preview-05-20"),
});

const buildAnthropicMap = () => ({
  "ask-model": anthropic("claude-sonnet-4-20250514"),
  "ask-model-free": anthropic("claude-sonnet-4-20250514"),
  "agent-model": anthropic("claude-sonnet-4-20250514"),
  "agent-model-free": anthropic("claude-sonnet-4-20250514"),
  "model-sonnet-4.6": anthropic("claude-sonnet-4-20250514"),
  "model-gpt-4.5": anthropic("claude-sonnet-4-20250514"),
  "model-gemini-3-flash": anthropic("claude-sonnet-4-20250514"),
  "model-deepseek-v4-flash": anthropic("claude-sonnet-4-20250514"),
  "model-opus-4.6": anthropic("claude-opus-4-20250514"),
  "model-kimi-k2.6": anthropic("claude-opus-4-20250514"),
  "fallback-agent-model": anthropic("claude-sonnet-4-20250514"),
  "fallback-ask-model": anthropic("claude-sonnet-4-20250514"),
  "fallback-gemini-3.5-flash": anthropic("claude-sonnet-4-20250514"),
  "fallback-grok-4.3": anthropic("claude-opus-4-20250514"),
  "title-generator-model": anthropic("claude-sonnet-4-20250514"),
  "final-review-model": anthropic("claude-sonnet-4-20250514"),
  "model-enterprise-planning": anthropic("claude-sonnet-4-20250514"),
  "model-enterprise-coding": anthropic("claude-sonnet-4-20250514"),
});

const buildOllamaMap = () => {
  const models: Record<string, any> = {
    "ask-model": ollama("qwen2.5-coder"),
    "ask-model-free": ollama("qwen2.5-coder"),
    "agent-model": ollama("qwen2.5-coder"),
    "agent-model-free": ollama("qwen2.5-coder"),
    "model-sonnet-4.6": ollama("qwen2.5-coder"),
    "model-gpt-4.5": ollama("qwen2.5-coder"),
    "model-gemini-3-flash": ollama("qwen2.5-coder"),
    "model-deepseek-v4-flash": ollama("deepseek-coder:6.7b"),
    "model-opus-4.6": ollama("qwen2.5-coder"),
    "model-kimi-k2.6": ollama("qwen2.5-coder"),
    "fallback-agent-model": ollama("qwen2.5-coder"),
    "fallback-ask-model": ollama("qwen2.5-coder"),
    "fallback-gemini-3.5-flash": ollama("qwen2.5-coder"),
    "fallback-grok-4.3": ollama("qwen2.5-coder"),
    "title-generator-model": ollama("qwen2.5-coder"),
    "final-review-model": ollama("qwen2.5-coder"),
    "model-enterprise-planning": ollama("qwen2.5-coder"),
    "model-enterprise-coding": ollama("qwen2.5-coder"),
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
  "agent-model-free": "May 2025",
  "model-sonnet-4.6": "May 2025",
  "model-gpt-4.5": "February 2025",
  "model-gemini-3-flash": "January 2025",
  "model-deepseek-v4-flash": "May 2025",
  "model-opus-4.6": "May 2025",
  "model-kimi-k2.6": "April 2024",
  "fallback-agent-model": "January 2025",
  "fallback-ask-model": "January 2025",
  "fallback-gemini-3.5-flash": "May 2026",
  "fallback-grok-4.3": "December 2025",
  "title-generator-model": "January 2025",
  "final-review-model": "May 2025",
  "model-enterprise-planning": "January 2025",
  "model-enterprise-coding": "January 2025",
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
  "model-sonnet-4.6": "Anthropic Claude Sonnet 4.6",
  "model-gpt-4.5": "OpenAI GPT-4.5",
  "model-gemini-3-flash": "Google Gemini 3 Flash",
  "model-deepseek-v4-flash": "DeepSeek V4 Flash",
  "model-opus-4.6": "Anthropic Claude Opus 4.6",
  "model-kimi-k2.6": "Moonshot Kimi K2.6",
  "fallback-agent-model":
    "Auto, an intelligent model router built by HackWithAI v2",
  "fallback-ask-model":
    "Auto, an intelligent model router built by HackWithAI v2",
  "fallback-gemini-3.5-flash": "Google Gemini 3.5 Flash",
  "fallback-grok-4.3":
    "Auto, an intelligent model router built by HackWithAI v2",
  "title-generator-model": "Google Gemini 3 Flash",
  "final-review-model": "Claude Sonnet 4 — Final Review & Audit",
  "model-enterprise-planning": "Hermes 3 405B — Enterprise Planning & Architecture",
  "model-enterprise-coding": "Qwen 2.5 Coder 32B — Enterprise Coding & Automation",
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
    modelName === "model-deepseek-v4-flash"
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
  return modelName === "ask-model" || modelName === "model-gemini-3-flash";
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
      return isAgentMode(mode) ? "model-kimi-k2.6" : "model-gemini-3-flash";
    case "hwai-pro":
      return "model-sonnet-4.6";
    case "hwai-max":
      return "model-opus-4.6";
    case "hwai-enterprise":
      return isAgentMode(mode) ? "model-enterprise-planning" : "model-enterprise-coding";
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
