/**
 * Scheduler — loads schedules from the vault, ticks on a 60s loop,
 * and executes due tasks as one-shot agent sessions.
 */

import * as path from "node:path";
import * as TOML from "smol-toml";
import type { VaultManager } from "./vault.js";
import type { OctopalAgent } from "./agent.js";
import {
  type ScheduledTask,
  type ScheduleFile,
  type ScheduleHistoryEntry,
  toCron,
  cronMatches,
} from "./schedule-types.js";

const SCHEDULES_DIR = "Meta/schedules";
const HISTORY_FILE = "Meta/schedules/history.md";

export interface SchedulerOptions {
  agent: OctopalAgent;
  vault: VaultManager;
  tickIntervalSeconds?: number;
  enabled?: boolean;
}

export class Scheduler {
  private agent: OctopalAgent;
  private vault: VaultManager;
  private tickInterval: number;
  private enabled: boolean;
  private tasks = new Map<string, ScheduledTask>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private executing = false;

  constructor(options: SchedulerOptions) {
    this.agent = options.agent;
    this.vault = options.vault;
    this.tickInterval = (options.tickIntervalSeconds ?? 60) * 1000;
    this.enabled = options.enabled ?? true;
  }

  /** Register a builtin schedule (code-defined, non-cancellable) */
  registerBuiltin(task: Omit<ScheduledTask, "builtin" | "enabled">): void {
    this.tasks.set(task.id, { ...task, builtin: true, enabled: true });
  }

  /** Load all .toml schedule files from the vault */
  async loadFromVault(): Promise<void> {
    // Keep builtins, clear file-based tasks
    for (const [id, task] of this.tasks) {
      if (!task.builtin) this.tasks.delete(id);
    }

    let files: string[];
    try {
      files = await this.vault.listDir(SCHEDULES_DIR);
    } catch {
      return; // Directory doesn't exist yet
    }

    for (const file of files) {
      if (!file.endsWith(".toml")) continue;

      try {
        const content = await this.vault.readFile(path.join(SCHEDULES_DIR, file));
        const parsed = TOML.parse(content) as unknown as ScheduleFile;
        const id = file.replace(/\.toml$/, "");

        this.tasks.set(id, {
          id,
          name: parsed.name ?? id,
          schedule: parsed.schedule ?? "",
          prompt: parsed.prompt,
          skill: parsed.skill,
          enabled: parsed.enabled ?? true,
          once: parsed.once,
          builtin: false,
        });
      } catch (err) {
        console.error(`[scheduler] Failed to load ${file}:`, err);
      }
    }

    console.log(`[scheduler] Loaded ${this.tasks.size} schedule(s)`);
  }

  /** Start the tick loop */
  async start(): Promise<void> {
    if (!this.enabled) {
      console.log("[scheduler] Disabled, not starting");
      return;
    }

    await this.loadFromVault();
    this.running = true;
    this.scheduleTick();
    console.log("[scheduler] Started");
  }

  /** Stop the tick loop */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[scheduler] Stopped");
  }

  /** Force reload schedules from vault (called after agent creates/cancels a task) */
  async reload(): Promise<void> {
    await this.loadFromVault();
  }

  /** List all scheduled tasks */
  listTasks(): ScheduledTask[] {
    return [...this.tasks.values()];
  }

  private scheduleTick(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.tick(), this.tickInterval);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      if (this.executing) {
        // Previous execution still running — skip this tick
        return;
      }
      await this.checkAndExecute();
    } catch (err) {
      console.error("[scheduler] Tick error:", err);
    } finally {
      this.scheduleTick();
    }
  }

  private async checkAndExecute(): Promise<void> {
    const now = new Date();

    for (const task of this.tasks.values()) {
      if (!task.enabled) continue;

      let isDue = false;

      if (task.once) {
        // One-off: check if the scheduled time has passed
        const target = new Date(task.once);
        isDue = now >= target;
      } else if (task.schedule) {
        // Recurring: check cron match
        try {
          const cron = toCron(task.schedule);
          isDue = cronMatches(cron, now);
        } catch (err) {
          console.error(`[scheduler] Bad schedule for "${task.id}":`, err);
          continue;
        }

        // Don't re-run if we already ran this minute
        if (isDue && task.lastRun) {
          const lastRunDate = new Date(task.lastRun);
          if (
            lastRunDate.getFullYear() === now.getFullYear() &&
            lastRunDate.getMonth() === now.getMonth() &&
            lastRunDate.getDate() === now.getDate() &&
            lastRunDate.getHours() === now.getHours() &&
            lastRunDate.getMinutes() === now.getMinutes()
          ) {
            isDue = false;
          }
        }
      }

      if (isDue) {
        await this.executeTask(task);
      }
    }
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    this.executing = true;
    const startedAt = new Date().toISOString();
    console.log(`[scheduler] Executing "${task.name}" (${task.id})`);

    let success = false;
    let summary = "";

    try {
      if (task.prompt.startsWith("__builtin:")) {
        summary = await this.executeBuiltin(task.prompt);
      } else {
        const response = await this.agent.run(task.prompt);
        summary = response.slice(0, 500);
      }
      success = true;
      console.log(`[scheduler] "${task.name}" completed`);
    } catch (err) {
      summary = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] "${task.name}" failed:`, summary);
    }

    const finishedAt = new Date().toISOString();
    task.lastRun = finishedAt;

    // Log to history
    await this.appendHistory({
      taskId: task.id,
      taskName: task.name,
      startedAt,
      finishedAt,
      success,
      summary,
    });

    // Clean up one-off tasks
    if (task.once) {
      try {
        await this.vault.deleteFile(path.join(SCHEDULES_DIR, `${task.id}.toml`));
      } catch {
        // Best effort
      }
      this.tasks.delete(task.id);
    }

    this.executing = false;
  }

  private async executeBuiltin(prompt: string): Promise<string> {
    const command = prompt.replace("__builtin:", "");
    switch (command) {
      case "vault-sync":
        await this.vault.pull();
        return "Vault synced (git pull)";
      default:
        throw new Error(`Unknown builtin command: ${command}`);
    }
  }

  private async appendHistory(entry: ScheduleHistoryEntry): Promise<void> {
    const line = `| ${entry.startedAt} | ${entry.taskName} | ${entry.success ? "✅" : "❌"} | ${entry.summary.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 200)} |`;

    let existing = "";
    try {
      existing = await this.vault.readFile(HISTORY_FILE);
    } catch {
      // Create header
      existing = `# Schedule History\n\n| Time | Task | Status | Summary |\n| --- | --- | --- | --- |\n`;
    }

    await this.vault.writeFile(HISTORY_FILE, existing + line + "\n");
  }
}
