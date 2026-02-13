import Fastify from "fastify";
import websocket from "@fastify/websocket";
import {
  OctopalAgent,
  Scheduler,
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

  // Initialize the scheduler
  const scheduler = new Scheduler({
    agent,
    vault: agent.vault,
    enabled: config.scheduler.enabled,
    tickIntervalSeconds: config.scheduler.tickIntervalSeconds,
  });

  // Register builtin scheduled tasks
  scheduler.registerBuiltin({
    id: "vault-sync",
    name: "Vault Sync",
    schedule: "*/30 * * * *",
    prompt: "__builtin:vault-sync",
  });

  // Make scheduler available to agent sessions
  agent.setScheduler(scheduler);

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

  // Start Discord connector if configured
  if (config.discord?.botToken) {
    const { DiscordConnector } = await import("@octopal/connector-discord");
    const discord = new DiscordConnector(config.discord, sessionStore);
    await discord.start();
    fastify.addHook("onClose", async () => {
      await discord.stop();
    });
  }

  // Start the scheduler
  await scheduler.start();

  // Graceful cleanup
  fastify.addHook("onClose", async () => {
    scheduler.stop();
    await sessionStore.destroyAll();
    await agent.stop();
  });

  const listenPort = port ?? config.server.port;
  const listenHost = host ?? "127.0.0.1";

  await fastify.listen({ port: listenPort, host: listenHost });

  return fastify;
}
