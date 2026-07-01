// ── Provider Registry — dependency-injected, no singletons ──

import type { AIProvider, ProviderConfig, ProviderModel } from "./types";
import type { ChatMessage, ChatOptions, StreamChunk, ProviderHealth } from "../types";

export class ProviderRegistry {
  private providers = new Map<string, AIProvider>();
  private configs = new Map<string, ProviderConfig>();
  private errors = new Map<string, string>();

  register(config: ProviderConfig, provider: AIProvider): void {
    this.configs.set(config.id, config);
    this.providers.set(config.id, provider);
    this.errors.delete(config.id);
  }

  get(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  getConfig(id: string): ProviderConfig | undefined {
    return this.configs.get(id);
  }

  list(): string[] {
    return Array.from(this.configs.values())
      .filter((c) => c.enabled)
      .map((c) => c.id);
  }

  async listModels(providerId?: string): Promise<ProviderModel[]> {
    if (providerId) {
      const p = this.providers.get(providerId);
      return p ? p.listModels() : [];
    }
    const results: ProviderModel[] = [];
    for (const [id, p] of this.providers.entries()) {
      if (this.configs.get(id)?.enabled !== false) {
        try {
          results.push(...(await p.listModels()));
        } catch {}
      }
    }
    return results;
  }

  async chat(
    providerId: string,
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatMessage> {
    const p = this.require(providerId);
    return p.chat(model, messages, options);
  }

  async *stream(
    providerId: string,
    model: string,
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<StreamChunk> {
    const p = this.require(providerId);
    yield* p.stream(model, messages, options);
  }

  async health(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];
    for (const [id, p] of this.providers.entries()) {
      const config = this.configs.get(id)!;
      try {
        const ok = await p.healthCheck();
        results.push({
          id,
          name: config.name,
          status: ok ? "connected" : "disconnected",
          models: (await p.listModels()).map((m) => m.id),
        });
      } catch (e) {
        results.push({
          id,
          name: config.name,
          status: "error",
          models: [],
          error: e instanceof Error ? e.message : String(e),
        });
        this.errors.set(id, e instanceof Error ? e.message : String(e));
      }
    }
    return results;
  }

  getErrors(): Record<string, string> {
    return Object.fromEntries(this.errors);
  }

  private require(id: string): AIProvider {
    const p = this.providers.get(id);
    if (!p) throw new Error(`Provider '${id}' not registered`);
    return p;
  }
}
