#!/usr/bin/env node
import { hostname } from "node:os";
import { OctopalRemoteConnector, shellHandler } from "./connector.js";
import { createLogger, initLogging } from "@octopal/core";

function usage(): never {
  console.error(`Usage: octopal-connector [options]

Connect this machine to an octopal daemon as a remote shell.

Options:
  --daemon-url <url>   Daemon WebSocket URL (or OCTOPAL_DAEMON_URL)
  --token <token>      Connector auth token (or OCTOPAL_TOKEN)
  --name <name>        Connector name (default: hostname, or OCTOPAL_CONNECTOR_NAME)
  --help               Show this help

Environment variables:
  OCTOPAL_DAEMON_URL        WebSocket URL (e.g. ws://192.168.1.10:3847/ws)
  OCTOPAL_TOKEN             Auth token with connector scope
  OCTOPAL_CONNECTOR_NAME    Connector name (default: hostname)`);
  process.exit(1);
}

function parseArgs(argv: string[]): { daemonUrl?: string; token?: string; name?: string } {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage();
    if (arg === "--daemon-url" && argv[i + 1]) result.daemonUrl = argv[++i];
    else if (arg === "--token" && argv[i + 1]) result.token = argv[++i];
    else if (arg === "--name" && argv[i + 1]) result.name = argv[++i];
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const daemonUrl = args.daemonUrl ?? process.env.OCTOPAL_DAEMON_URL;
  const token = args.token ?? process.env.OCTOPAL_TOKEN;
  const name = args.name ?? process.env.OCTOPAL_CONNECTOR_NAME ?? hostname();

  initLogging();
  const log = createLogger(`connector:${name}`);

  if (!daemonUrl) {
    console.error("Error: --daemon-url or OCTOPAL_DAEMON_URL is required");
    usage();
  }
  if (!token) {
    console.error("Error: --token or OCTOPAL_TOKEN is required");
    usage();
  }

  const connector = new OctopalRemoteConnector({
    name,
    daemonUrl,
    token,
    capabilities: ["shell"],
    metadata: {
      os: process.platform,
      arch: process.arch,
      hostname: hostname(),
      nodeVersion: process.version,
    },
  });

  connector.onRequest("shell", shellHandler());

  // Graceful shutdown
  const shutdown = async () => {
    log.info("Shutting down...");
    await connector.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Retry initial connection — daemon may not be up yet
  const maxDelay = 30_000;
  let delay = 1000;
  while (true) {
    try {
      await connector.connect();
      log.info(`Connected to ${daemonUrl}`);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Auth errors are not retryable
      if (msg.startsWith("Authentication failed")) {
        log.error(msg);
        process.exit(1);
      }
      const jitter = 1 + (Math.random() - 0.5) * 0.5;
      const wait = Math.min(delay * jitter, maxDelay);
      log.info(`Cannot reach daemon (${msg}), retrying in ${Math.round(wait / 1000)}s...`);
      await new Promise(r => setTimeout(r, wait));
      delay = Math.min(delay * 2, maxDelay);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
