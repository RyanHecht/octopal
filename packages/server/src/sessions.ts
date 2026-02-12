import type { CopilotSession, SessionEventHandler, AssistantMessageEvent } from "@github/copilot-sdk";
import type { OctopalAgent } from "@octopal/core";

/**
 * Maps deterministic session IDs to live SDK sessions.
 *
 * Session IDs follow the pattern `{connector}-{channelId}`:
 * - `cli-abc123` — CLI user session (token JTI)
 * - `discord-123456` — Discord channel session
 */
export class SessionStore {
  private sessions = new Map<string, CopilotSession>();

  constructor(private agent: OctopalAgent) {}

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
   */
  async sendOrRecover(
    sessionId: string,
    prompt: string,
    options?: {
      onEvent?: SessionEventHandler;
      timeoutMs?: number;
    },
  ): Promise<{ response: AssistantMessageEvent | undefined; recovered: boolean }> {
    const timeoutMs = options?.timeoutMs ?? 300_000;
    const session = await this.getOrCreate(sessionId, { onEvent: options?.onEvent });

    try {
      const response = await session.sendAndWait({ prompt }, timeoutMs);
      return { response, recovered: false };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("Session not found")) {
        throw err;
      }

      console.log(`[sessions] Session ${sessionId} expired server-side, recreating`);
      await this.destroy(sessionId);

      const freshSession = await this.getOrCreate(sessionId, { onEvent: options?.onEvent });
      const response = await freshSession.sendAndWait({ prompt }, timeoutMs);
      return { response, recovered: true };
    }
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
