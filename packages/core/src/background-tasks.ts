/**
 * BackgroundTaskManager — spawns one-shot agent sessions that run
 * independently of the main conversation. Results are delivered
 * via EventEmitter ("completed" / "failed") or polled via getCompleted().
 */

import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";
import type { OctopalAgent } from "./agent.js";

export interface BackgroundRun {
  runId: string;
  task: string;
  label?: string;
  requesterSessionId: string;
  status: "running" | "completed" | "failed";
  result?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface BackgroundTaskEvents {
  completed: [run: BackgroundRun];
  failed: [run: BackgroundRun];
  progress: [run: BackgroundRun, event: SessionEvent];
}

const MAX_CONCURRENT_TASKS = 5;

export class BackgroundTaskManager extends EventEmitter<BackgroundTaskEvents> {
  private runs = new Map<string, BackgroundRun>();
  private sessions = new Map<string, CopilotSession>();

  /**
   * Spawn a background task. Returns the runId immediately;
   * the task executes asynchronously in a separate agent session.
   */
  async spawn(
    agent: OctopalAgent,
    params: {
      task: string;
      label?: string;
      requesterSessionId: string;
    },
  ): Promise<string> {
    const activeCount = [...this.runs.values()].filter((r) => r.status === "running").length;
    if (activeCount >= MAX_CONCURRENT_TASKS) {
      throw new Error(
        `Maximum concurrent background tasks reached (${MAX_CONCURRENT_TASKS}). Wait for a task to complete or kill one first.`,
      );
    }

    const runId = crypto.randomUUID();
    const run: BackgroundRun = {
      runId,
      task: params.task,
      label: params.label,
      requesterSessionId: params.requesterSessionId,
      status: "running",
      startedAt: Date.now(),
    };
    this.runs.set(runId, run);

    // Fire-and-forget: create session, run task, emit result
    void this.executeTask(agent, run);

    return runId;
  }

  /** List all runs, optionally filtered by requester session */
  list(requesterSessionId?: string): BackgroundRun[] {
    const all = [...this.runs.values()];
    if (requesterSessionId) {
      return all.filter((r) => r.requesterSessionId === requesterSessionId);
    }
    return all;
  }

  /** Get a single run by ID */
  get(runId: string): BackgroundRun | undefined {
    return this.runs.get(runId);
  }

  /** Kill a running task. Returns true if it was actually running. */
  kill(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") return false;

    const session = this.sessions.get(runId);
    if (session) {
      session.abort().catch(() => {});
      session.destroy().catch(() => {});
      this.sessions.delete(runId);
    }

    run.status = "failed";
    run.error = "Killed by user";
    run.endedAt = Date.now();
    this.emit("failed", run);
    return true;
  }

  /**
   * Get and clear completed/failed runs for a requester.
   * Used by hooks to inject results on next user message.
   */
  getCompleted(requesterSessionId: string): BackgroundRun[] {
    const completed: BackgroundRun[] = [];
    for (const [id, run] of this.runs) {
      if (
        run.requesterSessionId === requesterSessionId &&
        (run.status === "completed" || run.status === "failed")
      ) {
        completed.push(run);
        this.runs.delete(id);
      }
    }
    return completed;
  }

  private async executeTask(agent: OctopalAgent, run: BackgroundRun): Promise<void> {
    let session: CopilotSession | undefined;
    try {
      session = await agent.createSession({
        sessionLogging: false,
        infiniteSessions: false,
      });
      this.sessions.set(run.runId, session);

      // Forward select events as progress
      session.on((event: SessionEvent) => {
        if (
          event.type === "assistant.intent" ||
          event.type === "tool.execution_start" ||
          event.type === "tool.execution_complete"
        ) {
          this.emit("progress", run, event);
        }
      });

      const systemContext = [
        "# Background Task",
        "",
        "You are running as a background task, independent of the main conversation.",
        "Complete the assigned task thoroughly and report your findings.",
        "",
        "## Rules",
        "1. Stay focused on the assigned task",
        "2. Your final message will be delivered to the main conversation",
        "3. Be concise but thorough in your final response",
        "4. Do not attempt to message or interact with the user directly",
        "",
      ].join("\n");

      const prompt = `${systemContext}\n## Task\n${run.task}`;
      const result = await agent.sendAndWait(session, prompt);

      run.status = "completed";
      run.result = result;
      run.endedAt = Date.now();
      this.emit("completed", run);
    } catch (err) {
      run.status = "failed";
      run.error = err instanceof Error ? err.message : String(err);
      run.endedAt = Date.now();
      this.emit("failed", run);
    } finally {
      this.sessions.delete(run.runId);
      if (session) {
        session.destroy().catch(() => {});
      }
    }
  }
}
