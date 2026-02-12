import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "./auth.js";
import type { ResolvedConfig, VaultManager, ParaManager } from "@octopal/core";

export function vaultRoutes(
  config: ResolvedConfig,
  vault: VaultManager,
  para: ParaManager,
) {
  return async function (fastify: FastifyInstance) {
    // GET /vault/structure — read PARA structure
    fastify.get("/structure", async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = await requireAuth(request, reply, config, "read");
      if (!payload) return;

      const structure = await para.getStructure();
      return { structure };
    });

    // GET /vault/note/* — read a note by path
    fastify.get("/note/*", async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = await requireAuth(request, reply, config, "read");
      if (!payload) return;

      const notePath = (request.params as { "*": string })["*"];
      if (!notePath) {
        return reply.status(400).send({ error: "Note path is required" });
      }

      try {
        const content = await vault.readFile(notePath);
        return { path: notePath, content };
      } catch {
        return reply.status(404).send({ error: `Note not found: ${notePath}` });
      }
    });

    // POST /vault/search — full-text search
    fastify.post("/search", async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = await requireAuth(request, reply, config, "read");
      if (!payload) return;

      const { query } = request.body as { query?: string };
      if (!query || typeof query !== "string") {
        return reply.status(400).send({ error: "query field is required" });
      }

      const results = await vault.search(query);
      return {
        query,
        results: results.slice(0, 50).map((r) => ({ path: r.path, line: r.line })),
      };
    });
  };
}
