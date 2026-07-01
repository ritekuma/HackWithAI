// ── Runtime Bootstrap ──
// Initializes the AI Runtime with default providers, models, and configuration.
// Singleton only for the bootstrapped runtime — consumers can create their own instances.

import { RuntimeManager } from "./manager";
import { ProviderRegistry } from "./providers/registry";
import { ModelRegistry } from "./models/registry";
import { ToolRegistry } from "./tools/registry";
import { MemoryRegistry } from "./memory/registry";
import { createOpenRouterProvider } from "./providers/openrouter";
import { createOpenAIProvider } from "./providers/openai";
import { createAnthropicProvider } from "./providers/anthropic";
import { createGeminiProvider } from "./providers/gemini";
import { createOllamaProvider } from "./providers/ollama";

let _runtime: RuntimeManager | null = null;

export function getRuntime(): RuntimeManager {
  if (!_runtime) {
    _runtime = bootstrapRuntime();
  }
  return _runtime;
}

function bootstrapRuntime(): RuntimeManager {
  const providers = new ProviderRegistry();
  const models = new ModelRegistry();
  const tools = new ToolRegistry();
  const memory = new MemoryRegistry();

  // ── Register providers ──

  // OpenRouter (primary)
  if (process.env.OPENROUTER_API_KEY) {
    providers.register(
      { id: "openrouter", name: "OpenRouter", enabled: true },
      createOpenRouterProvider(),
    );
  }

  // OpenAI
  if (process.env.OPENAI_API_KEY) {
    providers.register(
      { id: "openai", name: "OpenAI", apiKey: process.env.OPENAI_API_KEY, enabled: true },
      createOpenAIProvider(),
    );
  }

  // Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    providers.register(
      { id: "anthropic", name: "Anthropic", apiKey: process.env.ANTHROPIC_API_KEY, enabled: true },
      createAnthropicProvider(),
    );
  }

  // Google Gemini
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    providers.register(
      { id: "gemini", name: "Google Gemini", apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY, enabled: true },
      createGeminiProvider(),
    );
  }

  // Ollama (local)
  if (process.env.OLLAMA_ENABLED === "true") {
    providers.register(
      { id: "ollama", name: "Ollama", baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/api", enabled: true },
      createOllamaProvider(),
    );
  }

  // ── Register default models ──
  registerDefaultModels(models);

  const runtime = new RuntimeManager({ providers, models, tools, memory });

  // Start in background (non-blocking)
  runtime.start().catch(() => {});

  return runtime;
}

function registerDefaultModels(models: ModelRegistry): void {
  // OpenRouter models
  models.register({ id: "openai/gpt-4o", provider: "openrouter", capabilities: ["chat", "streaming", "tool_calling", "vision", "json_mode"], contextWindow: 128000, maxOutputTokens: 16384, aliases: ["gpt-4o"] });
  models.register({ id: "openai/gpt-4o-mini", provider: "openrouter", capabilities: ["chat", "streaming", "tool_calling", "vision"], contextWindow: 128000, maxOutputTokens: 16384, aliases: ["gpt-4o-mini"] });
  models.register({ id: "anthropic/claude-sonnet-4-20250514", provider: "openrouter", capabilities: ["chat", "streaming", "tool_calling", "vision"], contextWindow: 200000, maxOutputTokens: 64000, aliases: ["claude-sonnet-4", "claude-sonnet"] });
  models.register({ id: "anthropic/claude-3.5-sonnet", provider: "openrouter", capabilities: ["chat", "streaming", "tool_calling", "vision"], contextWindow: 200000, maxOutputTokens: 8192, aliases: ["claude-3.5-sonnet"] });
  models.register({ id: "google/gemini-2.5-flash", provider: "openrouter", capabilities: ["chat", "streaming"], contextWindow: 1048576, maxOutputTokens: 8192, aliases: ["gemini-2.5-flash"] });
  models.register({ id: "google/gemini-2.5-pro", provider: "openrouter", capabilities: ["chat", "streaming"], contextWindow: 1048576, maxOutputTokens: 8192, aliases: ["gemini-2.5-pro"] });

  // OpenAI direct
  models.register({ id: "gpt-4o", provider: "openai", capabilities: ["chat", "streaming", "tool_calling", "vision"], contextWindow: 128000, maxOutputTokens: 16384 });
  models.register({ id: "gpt-4o-mini", provider: "openai", capabilities: ["chat", "streaming", "tool_calling", "vision"], contextWindow: 128000, maxOutputTokens: 16384 });

  // Anthropic direct
  models.register({ id: "claude-sonnet-4-20250514", provider: "anthropic", capabilities: ["chat", "streaming", "tool_calling", "vision"], contextWindow: 200000, maxOutputTokens: 64000 });
  models.register({ id: "claude-3-5-sonnet-20241022", provider: "anthropic", capabilities: ["chat", "streaming", "tool_calling", "vision"], contextWindow: 200000, maxOutputTokens: 8192 });

  // Gemini direct
  models.register({ id: "gemini-2.5-flash", provider: "gemini", capabilities: ["chat", "streaming"], contextWindow: 1048576, maxOutputTokens: 8192 });
  models.register({ id: "gemini-2.5-pro", provider: "gemini", capabilities: ["chat", "streaming"], contextWindow: 1048576, maxOutputTokens: 8192 });
}
