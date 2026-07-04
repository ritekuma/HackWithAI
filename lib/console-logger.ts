// ── Centralized Console Logger ─────────────────────────────────────────
// Replaces direct console.* calls throughout the application.
// Errors and warnings always print. Info/debug/log only print in dev.

const isProduction =
  typeof window === "undefined"
    ? process.env.NODE_ENV === "production"
    : false;

const isDev = !isProduction;

export const consoleLogger = {
  log: isDev ? console.log.bind(console) : () => {},
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: isDev ? console.info.bind(console) : () => {},
  debug: isDev ? console.debug.bind(console) : () => {},
};
