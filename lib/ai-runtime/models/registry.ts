// ── Model Registry ──

import type { ModelEntry, ModelFilter } from "./types";
import type { Capability } from "../types";

export class ModelRegistry {
  private models = new Map<string, ModelEntry>();
  private aliases = new Map<string, string>();

  register(model: ModelEntry): void {
    this.models.set(model.id, model);
    if (model.aliases) {
      for (const alias of model.aliases) {
        this.aliases.set(alias, model.id);
      }
    }
  }

  get(idOrAlias: string): ModelEntry | undefined {
    return this.models.get(idOrAlias) ?? this.models.get(this.aliases.get(idOrAlias) ?? "");
  }

  resolve(alias: string): string {
    return this.aliases.get(alias) ?? alias;
  }

  list(filter?: ModelFilter): ModelEntry[] {
    const entries = Array.from(this.models.values());
    if (!filter) return entries;
    return entries.filter((m) => {
      if (filter.provider && m.provider !== filter.provider) return false;
      if (filter.capabilities?.length) {
        return filter.capabilities.every((c: Capability) => m.capabilities.includes(c));
      }
      return true;
    });
  }

  byProvider(providerId: string): ModelEntry[] {
    return this.list({ provider: providerId });
  }

  withCapability(capability: Capability): ModelEntry[] {
    return this.list({ capabilities: [capability] });
  }

  count(): number {
    return this.models.size;
  }
}
