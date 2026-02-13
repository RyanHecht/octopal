/**
 * Schedule types and minimal cron matching for the octopal scheduler.
 *
 * Supports standard 5-field cron (minute hour dom month dow) and
 * human-friendly interval sugar ("daily", "every 30m", etc.).
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface ScheduledTask {
  /** Unique identifier (derived from filename for file-based, fixed for builtins) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Cron expression or interval sugar (resolved to cron internally) */
  schedule: string;
  /** Prompt to send to the agent */
  prompt: string;
  /** Optional: restrict to a specific skill */
  skill?: string;
  /** Whether the schedule is active (default: true) */
  enabled: boolean;
  /** If set, this is a one-off task scheduled for a specific time (ISO 8601) */
  once?: string;
  /** Whether this is a builtin (code-defined, non-cancellable) */
  builtin: boolean;
  /** Last time this task was executed (ISO 8601) */
  lastRun?: string;
}

/** Shape of a .toml schedule file in the vault */
export interface ScheduleFile {
  name: string;
  schedule?: string;
  prompt: string;
  skill?: string;
  enabled?: boolean;
  once?: string;
}

export interface ScheduleHistoryEntry {
  taskId: string;
  taskName: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  summary: string;
}

// ── Interval sugar ─────────────────────────────────────────────────────

const INTERVAL_MAP: Record<string, string> = {
  "hourly": "0 * * * *",
  "daily": "0 9 * * *",
  "weekly": "0 9 * * 1",
  "monthly": "0 9 1 * *",
};

const EVERY_PATTERN = /^every\s+(\d+)\s*(m|min|minutes?|h|hr|hours?)$/i;

/** Convert interval sugar to a cron expression, or return as-is if already cron */
export function toCron(input: string): string {
  const lower = input.trim().toLowerCase();

  if (INTERVAL_MAP[lower]) return INTERVAL_MAP[lower];

  const m = lower.match(EVERY_PATTERN);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2][0]; // 'm' or 'h'
    if (unit === "m") {
      if (n < 1 || n > 59) throw new Error(`Invalid minute interval: ${n}`);
      return `*/${n} * * * *`;
    } else {
      if (n < 1 || n > 23) throw new Error(`Invalid hour interval: ${n}`);
      return `0 */${n} * * *`;
    }
  }

  // Assume it's already a cron expression
  return input.trim();
}

// ── Minimal cron matcher ───────────────────────────────────────────────

/** Day-of-week names for cron (0=SUN or 7=SUN) */
const DOW_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

function replaceNames(field: string, names: Record<string, number>): string {
  let result = field.toUpperCase();
  for (const [name, val] of Object.entries(names)) {
    result = result.replaceAll(name, String(val));
  }
  return result;
}

/** Parse a single cron field into a Set of matching values */
function parseField(field: string, min: number, max: number, names?: Record<string, number>): Set<number> {
  if (names) field = replaceNames(field, names);

  const values = new Set<number>();

  for (const part of field.split(",")) {
    const rangeStepped = part.match(/^(\d+|\*)-?(\d+)?(?:\/(\d+))?$/);

    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2), 10);
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (part.includes("-")) {
      const [rangePart, stepPart] = part.split("/");
      const [startStr, endStr] = rangePart.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      const step = stepPart ? parseInt(stepPart, 10) : 1;
      for (let i = start; i <= end; i += step) values.add(i);
    } else if (rangeStepped) {
      values.add(parseInt(part, 10));
    }
  }

  return values;
}

/** Check if a Date matches a 5-field cron expression */
export function cronMatches(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression (need 5 fields): "${cron}"`);
  }

  const [minF, hourF, domF, monF, dowF] = fields;

  const minute = parseField(minF, 0, 59);
  const hour = parseField(hourF, 0, 23);
  const dom = parseField(domF, 1, 31);
  const month = parseField(monF, 1, 12, MONTH_NAMES);
  const dow = parseField(dowF, 0, 7, DOW_NAMES);

  // Normalize Sunday: 7 → 0
  if (dow.has(7)) dow.add(0);

  const d = {
    min: date.getMinutes(),
    hour: date.getHours(),
    dom: date.getDate(),
    month: date.getMonth() + 1,
    dow: date.getDay(),
  };

  return (
    minute.has(d.min) &&
    hour.has(d.hour) &&
    dom.has(d.dom) &&
    month.has(d.month) &&
    dow.has(d.dow)
  );
}
