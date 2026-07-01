// ── AI Runtime Manager ──
// Lifecycle, health, and dependency injection hub.
// No singletons — consumers pass registries in.

import { ProviderRegistry } from "./providers/registry";
import { ModelRegistry } from "./models/registry";
import { ToolRegistry } from "./tools/registry";
import { MemoryRegistry } from "./memory/registry";
import type { RuntimeHealth, RuntimeStatus } from "./types";

export interface RuntimeConfig {
  providers: ProviderRegistry;
  models: ModelRegistry;
  tools: ToolRegistry;
  memory: MemoryRegistry;
}

export class RuntimeManager {
  readonly providers: ProviderRegistry;
  readonly models: ModelRegistry;
  readonly tools: ToolRegistry;
  readonly memory: MemoryRegistry;

  private _status: RuntimeStatus = "stopped";
  private startTime = 0;
  private startupErrors: string[] = [];

  constructor(config: RuntimeConfig) {
    this.providers = config.providers;
    this.models = config.models;
    this.tools = config.tools;
    this.memory = config.memory;
  }

  get status(): RuntimeStatus {
    return this._status;
  }

  get uptime(): number {
    return this.startTime ? Date.now() - this.startTime : 0;
  }

  async start(): Promise<void> {
    this._status = "starting";
    this.startTime = Date.now();
    this.startupErrors = [];

    try {
      // Validate provider health
      const providerHealth = await this.providers.health();
      const connectedCount = providerHealth.filter((p) => p.status === "connected").length;
      if (connectedCount === 0 && this.providers.list().length > 0) {
        this._status = "degraded";
        this.startupErrors.push("No providers connected");
      } else {
        this._status = "running";
      }
    } catch (e) {
      this._status = "degraded";
      this.startupErrors.push(e instanceof Error ? e.message : String(e));
    }
  }

  async stop(): Promise<void> {
    this._status = "stopped";
    this.startTime = 0;
  }

  async health(): Promise<RuntimeHealth> {
    const providerHealth = this.providers.list().length > 0
      ? await this.providers.health()
      : [];

    return {
      status: this._status,
      uptime: this.uptime,
      providers: providerHealth,
      models: this.models.count(),
      tools: this.tools.count(),
      memoryServices: this.memory.count(),
      startupErrors: this.startupErrors,
    };
  }
}
