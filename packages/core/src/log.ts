/**
 * Lightweight structured logger for Octopal.
 *
 * Usage:
 *   import { createLogger } from "@octopal/core";
 *   const log = createLogger("discord");
 *   log.info("Logged in as", tag);
 *   // => [19:45:14] INFO  [discord] Logged in as OctopalBot
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  error: "ERROR",
  warn: "WARN ",
  info: "INFO ",
  debug: "DEBUG",
};

let globalLevel: LogLevel = "info";

/** Set the global log level. Messages above this verbosity are suppressed. */
export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

/** Get the current global log level. */
export function getLogLevel(): LogLevel {
  return globalLevel;
}

/**
 * Initialize logging from environment and/or config.
 * Call once at startup. `OCTOPAL_LOG_LEVEL` env var takes priority.
 */
export function initLogging(options?: { level?: LogLevel }): void {
  const envLevel = process.env.OCTOPAL_LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LEVEL_RANK) {
    globalLevel = envLevel as LogLevel;
  } else if (options?.level) {
    globalLevel = options.level;
  }
}

function timestamp(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatPrefix(level: LogLevel, tag: string): string {
  return `[${timestamp()}] ${LEVEL_LABEL[level]} [${tag}]`;
}

export interface Logger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  /** Start a timer. Returns a function that logs elapsed time at the given level. */
  timed(label: string, level?: LogLevel): () => void;
}

/** Create a logger with the given tag (e.g., "discord", "scheduler"). */
export function createLogger(tag: string): Logger {
  const emit = (level: LogLevel, message: string, args: unknown[]): void => {
    if (LEVEL_RANK[level] > LEVEL_RANK[globalLevel]) return;
    const prefix = formatPrefix(level, tag);
    const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    if (args.length === 0) {
      writer(prefix, message);
    } else {
      writer(prefix, message, ...args);
    }
  };

  return {
    error: (message, ...args) => emit("error", message, args),
    warn: (message, ...args) => emit("warn", message, args),
    info: (message, ...args) => emit("info", message, args),
    debug: (message, ...args) => emit("debug", message, args),
    timed(label: string, level: LogLevel = "debug") {
      const start = performance.now();
      return () => {
        const elapsed = performance.now() - start;
        emit(level, `${label} (${formatElapsed(elapsed)})`, []);
      };
    },
  };
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
