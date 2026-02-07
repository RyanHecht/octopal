#!/usr/bin/env node

import { IngestPipeline } from "@octopal/core";

const HELP = `
octopal — personal PARA knowledge agent

Usage:
  octopal setup [vault-path]   Interactive vault setup (guided onboarding)
  octopal ingest <text>        Ingest a note, brain dump, or transcript
  octopal ingest -             Read from stdin
  octopal --help               Show this help

Environment:
  OCTOPAL_VAULT_PATH          Path to local vault directory (required for ingest)
  OCTOPAL_VAULT_REMOTE        Git remote URL for the vault (optional)

Examples:
  octopal setup ~/my-vault
  octopal ingest "Met with Alice about the website redesign. She wants new colors by Friday."
  echo "some notes" | octopal ingest -
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP.trim());
    process.exit(0);
  }

  const vaultPath = process.env.OCTOPAL_VAULT_PATH;
  if (!vaultPath) {
    console.error("Error: OCTOPAL_VAULT_PATH environment variable is required.");
    console.error("Set it to the local path where your PARA vault lives.");
    process.exit(1);
  }

  const command = args[0];

  if (command === "setup") {
    // Delegate to setup script
    const setupPath = new URL("./setup.js", import.meta.url).pathname;
    const { execFile } = await import("node:child_process");
    const child = execFile(
      process.execPath,
      [setupPath, ...args.slice(1)],
      { stdio: "inherit", env: process.env } as any,
    );
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  } else if (command === "ingest") {
    let text: string;

    if (args[1] === "-") {
      // Read from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      text = Buffer.concat(chunks).toString("utf-8").trim();
    } else {
      text = args.slice(1).join(" ");
    }

    if (!text) {
      console.error("Error: No text provided to ingest.");
      process.exit(1);
    }

    const pipeline = new IngestPipeline({
      vault: {
        localPath: vaultPath,
        remoteUrl: process.env.OCTOPAL_VAULT_REMOTE,
      },
    });

    console.log("🐙 Processing your input...\n");
    const result = await pipeline.ingest(text);
    console.log(result.summary);
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
