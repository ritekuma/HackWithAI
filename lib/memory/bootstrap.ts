// ── Memory Bootstrap ──

import { UnifiedMemoryRegistry } from "./registry";

let _memory: UnifiedMemoryRegistry | null = null;

export function getMemory(): UnifiedMemoryRegistry {
  if (!_memory) {
    _memory = new UnifiedMemoryRegistry();
  }
  return _memory;
}
