// ── Model types ──

import type { Capability } from "../types";

export interface ModelEntry {
  id: string;
  provider: string;
  aliases?: string[];
  capabilities: Capability[];
  contextWindow: number;
  maxOutputTokens: number;
  pricing?: {
    inputPer1k: number;
    outputPer1k: number;
  };
}

export type ModelFilter = Partial<Pick<ModelEntry, "provider" | "capabilities">>;
