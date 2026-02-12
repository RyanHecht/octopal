#!/usr/bin/env node

import { loadConfig, isConfigured, hashPassword, saveConfig } from "@octopal/core";
import { createServer } from "./server.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
octopal-server — persistent HTTP + WebSocket server for octopal

Usage:
  octopal serve [options]

Options:
  --port <port>          Port to listen on (default: 3847)
  --host <host>          Host to bind to (default: 127.0.0.1)
  --set-password         Set or change the admin password, then exit
  --help                 Show this help
    `.trim());
    process.exit(0);
  }

  const config = await loadConfig();

  // Handle --set-password
  if (args.includes("--set-password")) {
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, resolve));

    const password = await ask("Enter new admin password: ");
    if (!password.trim()) {
      console.error("Password cannot be empty.");
      process.exit(1);
    }

    const hash = await hashPassword(password.trim());
    await saveConfig({ server: { passwordHash: hash } });
    console.log("✅ Admin password saved.");
    rl.close();
    process.exit(0);
  }

  if (!isConfigured(config)) {
    console.error("Octopal is not configured. Run 'octopal setup' first.");
    process.exit(1);
  }

  if (!config.server.passwordHash) {
    console.error("No admin password set. Run with --set-password first.");
    process.exit(1);
  }

  // Parse port/host from args
  let port = config.server.port;
  let host = "127.0.0.1";

  const portIdx = args.indexOf("--port");
  if (portIdx !== -1 && args[portIdx + 1]) {
    port = parseInt(args[portIdx + 1], 10);
  }
  const hostIdx = args.indexOf("--host");
  if (hostIdx !== -1 && args[hostIdx + 1]) {
    host = args[hostIdx + 1];
  }

  console.log(`🐙 Starting octopal server on ${host}:${port}...`);

  const server = await createServer({ config, host, port });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n🐙 Shutting down...");
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep the process alive (Fastify server keeps event loop active)
  console.log("✅ Server is running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
