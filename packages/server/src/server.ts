import Fastify from "fastify";
import websocket from "@fastify/websocket";
import {
  OctopalAgent,
  type ResolvedConfig,
} from "@octopal/core";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { vaultRoutes } from "./routes/vault.js";
import { registerWebSocket } from "./ws.js";
import { SessionStore } from "./sessions.js";

export interface ServerOptions {
  config: ResolvedConfig;
  host?: string;
  port?: number;
}

export async function createServer({ config, host, port }: ServerOptions) {
  const fastify = Fastify({
    logger: {
      level: "info",
    },
  });

  // Initialize the agent — single instance for all sessions
  const agent = new OctopalAgent({
    vault: {
      localPath: config.vaultPath,
      remoteUrl: config.vaultRemoteUrl,
    },
    configDir: config.configDir,
  });
  await agent.init();

  const sessionStore = new SessionStore(agent);

  // Register plugins
  await fastify.register(websocket);

  // Health check (no auth)
  fastify.get("/health", async () => ({
    status: "ok",
    uptime: process.uptime(),
    sessions: sessionStore.list().length,
  }));

  // Register routes
  await fastify.register(authRoutes(config), { prefix: "/auth" });
  await fastify.register(chatRoutes(config, sessionStore), { prefix: "" });
  await fastify.register(vaultRoutes(config, agent.vault, agent.para), { prefix: "/vault" });

  // Register WebSocket handler
  registerWebSocket(fastify, config, agent, sessionStore);

  const listenPort = port ?? config.server.port;
  const listenHost = host ?? "127.0.0.1";

  await fastify.listen({ port: listenPort, host: listenHost });

  // Graceful cleanup
  fastify.addHook("onClose", async () => {
    await sessionStore.destroyAll();
    await agent.stop();
  });

  return fastify;
}
