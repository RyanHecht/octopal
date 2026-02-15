#!/usr/bin/env node

import { OctopalAgent, loadConfig, isConfigured, CONFIG_TEMPLATE } from "@octopal/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const HELP = `
octopal — personal AI assistant with persistent knowledge vault

Usage:
  octopal init               Write a default config.toml to ~/.octopal/
  octopal setup              Interactive vault setup (first-time onboarding)
  octopal chat <text>        Chat with Octopal (uses daemon if running, else standalone)
  octopal ingest <text>      Ingest a note, brain dump, or transcript
  octopal ingest -           Read from stdin
  octopal skills list        List all available skills and their sources
  octopal skills create <n>  Create a new skill in ~/.octopal/skills/
  octopal serve [options]    Start the daemon (HTTP + WebSocket server)
  octopal --help             Show this help

Config:
  Stored in ~/.octopal/config.toml (created by 'octopal init' or 'octopal setup')
  Vault is cloned to ~/.octopal/vault/

Environment overrides:
  OCTOPAL_HOME               Override config/data directory (default: ~/.octopal)
  OCTOPAL_VAULT_PATH         Override local vault path
  OCTOPAL_VAULT_REMOTE       Override git remote URL
  OCTOPAL_SERVER_PORT        Override server port (default: 3847)

Examples:
  octopal init
  octopal setup
  octopal chat "What projects am I working on?"
  octopal ingest "Met with Alice about the website redesign. New colors by Friday."
  echo "some notes" | octopal ingest -
  octopal skills list
  octopal skills create my-skill
  octopal serve --set-password
  octopal serve --port 8080
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP.trim());
    process.exit(0);
  }

  const command = args[0];

  if (command === "init") {
    const config = await loadConfig();
    const configPath = path.join(config.configDir, "config.toml");
    const force = args.includes("--force") || args.includes("-f");

    if (!force) {
      try {
        await fs.access(configPath);
        console.error(`Config already exists at ${configPath}`);
        console.error("Use --force to overwrite.");
        process.exit(1);
      } catch {
        // File doesn't exist — good
      }
    }

    await fs.mkdir(config.configDir, { recursive: true });
    await fs.writeFile(configPath, CONFIG_TEMPLATE, { encoding: "utf-8", mode: 0o600 });
    console.log(`Config written to ${configPath}`);
    return;
  }

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

  if (command === "serve") {
    // Delegate to the server package
    const serverPath = new URL("../../server/dist/index.js", import.meta.url).pathname;
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [serverPath, ...args.slice(1)], {
      stdio: "inherit",
    });
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  // Load config for commands that need it (everything except setup and serve)
  const config = await loadConfig();

  if (command === "skills") {
    const subcommand = args[1];

    if (subcommand === "list") {
      const { listSkills } = await import("./skills.js");
      await listSkills(config);
      return;
    }

    if (subcommand === "create") {
      const name = args[2];
      if (!name) {
        console.error("Error: Skill name is required. Usage: octopal skills create <name>");
        process.exit(1);
      }
      const { createSkill } = await import("./skills.js");
      await createSkill(config, name);
      return;
    }

    console.error(`Unknown skills subcommand: ${subcommand}`);
    console.log("Usage: octopal skills list | octopal skills create <name>");
    process.exit(1);
  }

  // All other commands need a configured vault
  if (!isConfigured(config)) {
    console.error("Octopal is not configured yet. Run 'octopal setup' to get started.");
    process.exit(1);
  }

  if (command === "chat") {
    const text = args.slice(1).join(" ").trim();
    if (!text) {
      console.error("Error: No message provided. Usage: octopal chat <text>");
      process.exit(1);
    }

    // Try connecting to daemon first
    if (config.server?.tokenSecret) {
      const { tryConnectDaemon } = await import("./client.js");
      const { mintToken } = await import("@octopal/core");
      const port = config.server.port ?? 3847;
      const token = mintToken(config.server.tokenSecret, {
        sub: "cli",
        scopes: ["chat", "read"],
        expiresIn: 300,
      });

      const client = await tryConnectDaemon(port, token);
      if (client) {
        try {
          await client.chat(text, {
            onDelta: (content) => process.stdout.write(content),
          });
          console.log();
          return;
        } finally {
          client.disconnect();
        }
      }
    }

    // Fallback: standalone mode
    const agent = new OctopalAgent({
      vault: {
        localPath: config.vaultPath,
        remoteUrl: config.vaultRemoteUrl,
      },
      configDir: config.configDir,
      vaultBaseUrl: config.vaultBaseUrl,
      vaultPathPrefix: config.vaultPathPrefix,
    });

    await agent.init();
    try {
      await agent.run(text, {
        onEvent: (event) => {
          if (event.type === "assistant.message_delta") {
            process.stdout.write(event.data.deltaContent ?? "");
          }
        },
      });
    } finally {
      await agent.stop();
    }
    console.log();
    return;
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

    const agent = new OctopalAgent({
      vault: {
        localPath: config.vaultPath,
        remoteUrl: config.vaultRemoteUrl,
      },
      configDir: config.configDir,
      vaultBaseUrl: config.vaultBaseUrl,
      vaultPathPrefix: config.vaultPathPrefix,
    });

    console.log("🐙 Processing your input...\n");
    await agent.init();
    try {
      await agent.run(`Please process the following raw input into the vault:\n\n---\n${text}\n---`, {
        onEvent: (event) => {
          if (event.type === "assistant.message_delta") {
            process.stdout.write(event.data.deltaContent ?? "");
          }
        },
      });

      // Auto-commit fallback
      if (await agent.vault.hasUncommittedChanges()) {
        await agent.vault.commitAndPush("octopal: auto-commit ingested changes");
      }
    } finally {
      await agent.stop();
    }
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
