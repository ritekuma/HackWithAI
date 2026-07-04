export const LOCAL_ONLY_USER_ID = "local-kali-user";

export function isLocalOnlyMode(): boolean {
  return process.env.LOCAL_ONLY_MODE === "true" || process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE === "true";
}

export function isLocalOnlyModeClient(): boolean {
  return process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE === "true";
}

export const RuntimeConfig = {
  get isLocalMode(): boolean { return isLocalOnlyMode(); },
  get isLocalModeClient(): boolean { return isLocalOnlyModeClient(); },
  get localUserId(): string { return LOCAL_ONLY_USER_ID; },
  get providerMode(): string { return process.env.PROVIDER_MODE || "openrouter"; },
  get isOpenRouter(): boolean { return process.env.PROVIDER_MODE !== "ollama"; },
};
