import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "./auth.js";
import type { ResolvedConfig } from "@octopal/core";
import type { SessionStore } from "../sessions.js";

export function chatRoutes(config: ResolvedConfig, sessionStore: SessionStore) {
  return async function (fastify: FastifyInstance) {
    // POST /chat — one-shot request/response chat
    fastify.post("/chat", async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = await requireAuth(request, reply, config, "chat");
      if (!payload) return;

      const { text, sessionId: requestedSessionId } = request.body as {
        text?: string;
        sessionId?: string;
      };

      if (!text || typeof text !== "string" || !text.trim()) {
        return reply.status(400).send({ error: "text field is required" });
      }

      const sessionId = requestedSessionId ?? `cli-${payload.jti}`;

      try {
        const session = await sessionStore.getOrCreate(sessionId);
        const response = await session.sendAndWait({ prompt: text.trim() }, 300_000);
        const responseText = response?.data?.content ?? "";

        return { sessionId, text: responseText };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    });
  };
}
