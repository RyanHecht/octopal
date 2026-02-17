import type { CopilotSession, SessionEventHandler, AssistantMessageEvent, SessionEvent, Tool } from "@github/copilot-sdk";
import { createLogger, type OctopalAgent, type Source } from "@octopal/core";

const log = createLogger("sessions");

/**
 * Maps deterministic session IDs to live SDK sessions.
 *
 * Session IDs follow the pattern `{connector}-{channelId}`:
 * - `cli-abc123` — CLI user session (token JTI)
 * - `discord-dm-123456` — Discord DM session
 * - `discord-th-789012` — Discord thread session
 */
export class SessionStore {
  private sessions = new Map<string, CopilotSession>();
  private extraTools: Tool<any>[] = [];

  constructor(private agent: OctopalAgent) {}

  /** Register extra tools that will be included in all new sessions */
  setExtraTools(tools: Tool<any>[]): void {
    this.extraTools = tools;
  }

  /** Get an existing session or create a new one */
  async getOrCreate(
    sessionId: string,
    options?: { onEvent?: SessionEventHandler },
  ): Promise<CopilotSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      // Re-attach event handler if provided
      if (options?.onEvent) {
        existing.on(options.onEvent);
      }
      return existing;
    }

    // Create a new persistent session
    const session = await this.agent.createSession({
      sessionId,
      infiniteSessions: true,
      onEvent: options?.onEvent,
      extraTools: this.extraTools,
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  /** Destroy a session and remove it from the store */
  async destroy(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.destroy();
      this.sessions.delete(sessionId);
    }
    this.agent.cleanupSession(sessionId);
  }

  /** Check if a session exists */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** List all active session IDs */
  list(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Send a prompt, automatically recovering if the SDK session expired.
   * Returns { response, recovered } — callers can notify users when recovered.
   *
   * Uses an inactivity-based timeout: the timer resets on every SDK event,
   * so long-running but active turns (tool calls, streaming) won't timeout.
   * Only truly stalled turns (no events for `inactivityTimeoutMs`) will fail.
   */
  async sendOrRecover(
    sessionId: string,
    prompt: string,
    options?: {
      onEvent?: SessionEventHandler;
      onSource?: (source: Source) => void;
      inactivityTimeoutMs?: number;
    },
  ): Promise<{ response: AssistantMessageEvent | undefined; recovered: boolean }> {
    const inactivityMs = options?.inactivityTimeoutMs ?? 300_000;
    const session = await this.getOrCreate(sessionId, { onEvent: options?.onEvent });

    // Subscribe to source collector if callback provided
    const collector = options?.onSource ? this.agent.getSourceCollector(sessionId) : undefined;
    const unsubSource = collector && options?.onSource
      ? () => { collector.removeListener("source", options.onSource!); }
      : undefined;
    if (collector && options?.onSource) {
      collector.on("source", options.onSource);
    }

    const done = log.timed(`sendOrRecover ${sessionId}`, "info");
    try {
      const response = await this.sendWithActivityTimeout(session, prompt, inactivityMs);
      unsubSource?.();
      done();
      return { response, recovered: false };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes("Session not found")) {
        log.info(`Session ${sessionId} expired server-side, recreating`);
        unsubSource?.();
        await this.destroy(sessionId);
        const freshSession = await this.getOrCreate(sessionId, { onEvent: options?.onEvent });

        // Re-subscribe to source collector on the fresh session
        const freshCollector = options?.onSource ? this.agent.getSourceCollector(sessionId) : undefined;
        if (freshCollector && options?.onSource) {
          freshCollector.on("source", options.onSource);
        }

        try {
          const response = await this.sendWithActivityTimeout(freshSession, prompt, inactivityMs);
          done();
          return { response, recovered: true };
        } finally {
          if (freshCollector && options?.onSource) {
            freshCollector.removeListener("source", options.onSource);
          }
        }
      }

      // On timeout or other errors, destroy the session to prevent
      // a stale session from breaking subsequent messages.
      log.warn(`Session ${sessionId} error, destroying: ${message}`);
      unsubSource?.();
      // Flush any incomplete turn data before destroying
      await this.agent.flushSessionLog(sessionId).catch((e) => {
        log.warn("Failed to flush session log on error:", e);
      });
      await this.destroy(sessionId);
      done();
      throw err;
    }
  }

  /**
   * Send a prompt and wait for session.idle, resetting the timeout on every
   * event received. Unlike sendAndWait, long-running active turns won't timeout.
   */
  private sendWithActivityTimeout(
    session: CopilotSession,
    prompt: string,
    inactivityMs: number,
  ): Promise<AssistantMessageEvent | undefined> {
    return new Promise<AssistantMessageEvent | undefined>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      let lastAssistantMessage: AssistantMessageEvent | undefined;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
      };

      const resetTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Inactivity timeout after ${inactivityMs}ms with no events`));
        }, inactivityMs);
      };

      const unsubscribe = session.on((event: SessionEvent) => {
        resetTimer();
        if (event.type === "assistant.message") {
          lastAssistantMessage = event as AssistantMessageEvent;
        } else if (event.type === "session.idle") {
          cleanup();
          resolve(lastAssistantMessage);
        } else if (event.type === "session.error") {
          cleanup();
          reject(new Error((event as any).data?.message ?? "Session error"));
        }
      });

      resetTimer();
      session.send({ prompt }).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  /** Destroy all sessions */
  async destroyAll(): Promise<void> {
    for (const [id, session] of this.sessions) {
      try {
        await session.destroy();
      } catch {
        // Best-effort cleanup
      }
    }
    this.sessions.clear();
  }
}
