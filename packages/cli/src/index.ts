#!/usr/bin/env node

import { IngestPipeline, loadConfig, isConfigured } from "@octopal/core";

const HELP = `
octopal — personal PARA knowledge agent

Usage:
  octopal setup              Interactive vault setup (first-time onboarding)
  octopal ingest <text>      Ingest a note, brain dump, or transcript
  octopal ingest -           Read from stdin
  octopal --help             Show this help

Config:
  Stored in ~/.octopal/config.json (created by 'octopal setup')
  Vault is cloned to ~/.octopal/vault/

Environment overrides:
  OCTOPAL_HOME               Override config/data directory (default: ~/.octopal)
  OCTOPAL_VAULT_PATH         Override local vault path
  OCTOPAL_VAULT_REMOTE       Override git remote URL

Examples:
  octopal setup
  octopal ingest "Met with Alice about the website redesign. New colors by Friday."
  echo "some notes" | octopal ingest -
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP.trim());
    process.exit(0);
  }

  const command = args[0];

  if (command === "setup") {
    // Delegate to setup script — no config needed yet
    const setupPath = new URL("./setup.js", import.meta.url).pathname;
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [setupPath, ...args.slice(1)], {
      stdio: "inherit",
    });
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  // All other commands need a configured vault
  const config = await loadConfig();

  if (!isConfigured(config)) {
    console.error("Octopal is not configured yet. Run 'octopal setup' to get started.");
    process.exit(1);
  }

  if (command === "ingest") {
    let text: string;

    if (args[1] === "-") {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      text = Buffer.concat(chunks).toString("utf-8").trim();
    } else {
      text = args.slice(1).join(" ").trim();
    }

    if (!text) {
      console.error("Error: No text provided to ingest.");
      process.exit(1);
    }

    const pipeline = new IngestPipeline({
      vault: {
        localPath: config.vaultPath,
        remoteUrl: config.vaultRemoteUrl,
      },
    });

    console.log("🐙 Processing your input...\n");
    const result = await pipeline.ingest(text, {
      onEvent: (event) => {
        if (event.type === "assistant.message_delta") {
          process.stdout.write(event.data.deltaContent ?? "");
        }
      },
    });
    console.log();
  } else {
    console.error(`Unknown command: ${command}`);
    console.log(HELP.trim());
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
