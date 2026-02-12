import type { CopilotSession, SessionEventHandler } from "@github/copilot-sdk";
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
