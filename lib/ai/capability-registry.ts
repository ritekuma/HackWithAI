// ── Provider Capability Registry ──
// Centralized lookup for model capabilities. Cached in memory,
// refreshed only on config change. Prevents sending images to
// non-vision models and tools to non-tool models.

export interface ModelCapability {
  provider: string;
  modelKey: string;
  supportsVision: boolean;
  supportsImages: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsPDF: boolean;
  maxContext: number;
  maxImageCount: number;
  supportedMimeTypes: string[];
}

// ── Capability Matrix ─────────────────────────────────────────────────

const CAPABILITIES: Record<string, ModelCapability> = {
  // OpenRouter models
  "model-standard-fallback": {
    provider: "openrouter", modelKey: "model-standard-fallback",
    supportsVision: false, supportsImages: false, supportsTools: false,
    supportsStreaming: true, supportsPDF: false,
    maxContext: 128_000, maxImageCount: 0,
    supportedMimeTypes: [],
  },
  "model-standard-chat": {
    provider: "openrouter", modelKey: "model-standard-chat",
    supportsVision: false, supportsImages: false, supportsTools: true,
    supportsStreaming: true, supportsPDF: false,
    maxContext: 128_000, maxImageCount: 0,
    supportedMimeTypes: [],
  },
  "model-vision": {
    provider: "openrouter", modelKey: "model-vision",
    supportsVision: true, supportsImages: true, supportsTools: false,
    supportsStreaming: true, supportsPDF: false,
    maxContext: 128_000, maxImageCount: 10,
    supportedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  },
  "model-standard-vision": {
    provider: "openrouter", modelKey: "model-standard-vision",
    supportsVision: true, supportsImages: true, supportsTools: false,
    supportsStreaming: true, supportsPDF: false,
    maxContext: 128_000, maxImageCount: 10,
    supportedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  },
  "ask-model": {
    provider: "openrouter", modelKey: "ask-model",
    supportsVision: false, supportsImages: false, supportsTools: false,
    supportsStreaming: true, supportsPDF: false,
    maxContext: 128_000, maxImageCount: 0,
    supportedMimeTypes: [],
  },
  "agent-model": {
    provider: "openrouter", modelKey: "agent-model",
    supportsVision: false, supportsImages: false, supportsTools: true,
    supportsStreaming: true, supportsPDF: false,
    maxContext: 128_000, maxImageCount: 0,
    supportedMimeTypes: [],
  },
};

// ── Default capability for unknown models ──────────────────────────────

const DEFAULT_CAPABILITY: ModelCapability = {
  provider: "unknown", modelKey: "unknown",
  supportsVision: false, supportsImages: false, supportsTools: false,
  supportsStreaming: true, supportsPDF: false,
  maxContext: 128_000, maxImageCount: 0,
  supportedMimeTypes: [],
};

// ── Cache ──────────────────────────────────────────────────────────────

let _cache: typeof CAPABILITIES | null = null;

function getCapabilities() {
  if (!_cache) _cache = { ...CAPABILITIES };
  return _cache;
}

export function refreshCapabilities(capabilities?: typeof CAPABILITIES) {
  _cache = capabilities ? { ...capabilities } : { ...CAPABILITIES };
}

// ── Lookup ─────────────────────────────────────────────────────────────

export function getModelCapability(modelKey: string): ModelCapability {
  return getCapabilities()[modelKey] || DEFAULT_CAPABILITY;
}

export function supportsVision(modelKey: string): boolean {
  return getModelCapability(modelKey).supportsVision;
}

export function supportsTools(modelKey: string): boolean {
  return getModelCapability(modelKey).supportsTools;
}

// ── Routing ─────────────────────────────────────────────────────────────

const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function detectHasImages(messages: any[]): boolean {
  return messages.some((m) =>
    Array.isArray((m as any).parts) &&
    (m as any).parts.some((p: any) =>
      (p.type === "image") ||
      (p.type === "file" && IMAGE_MIME_TYPES.includes(p.mediaType || "")) ||
      (typeof p.url === "string" && p.url.startsWith("data:image/"))
    )
  );
}

/**
 * Given a requested model key and whether images are present,
 * returns the best model key to use. Falls back to vision model
 * if images are present and requested model doesn't support vision.
 */
export function routeModel(requestedKey: string, hasImages: boolean): string {
  const cap = getModelCapability(requestedKey);
  if (hasImages && !cap.supportsVision) {
    return "model-vision";
  }
  return requestedKey;
}

// ── Diagnostic ──────────────────────────────────────────────────────────

export function getRoutingDiagnostic(requestedKey: string, hasImages: boolean) {
  const cap = getModelCapability(requestedKey);
  const routed = routeModel(requestedKey, hasImages);
  return {
    requested: requestedKey,
    routed,
    rerouted: requestedKey !== routed,
    reason: requestedKey !== routed
      ? `${requestedKey} lacks vision support → ${routed}`
      : "direct",
    capabilities: cap,
  };
}
