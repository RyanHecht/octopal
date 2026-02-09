#!/usr/bin/env node

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CopilotClient } from "@github/copilot-sdk";
import {
  VaultManager,
  ParaManager,
  TaskManager,
  buildCopilotTools,
  loadConfig,
  saveConfig,
  SETUP_PROMPT,
} from "@octopal/core";

const exec = promisify(execFile);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  console.log("🐙 Welcome to Octopal!\n");

  // Check that gh is installed and authenticated
  try {
    await exec("gh", ["auth", "status"]);
  } catch {
    console.error(
      "Error: The GitHub CLI (gh) is required and must be authenticated.\n\n" +
        "  Install: https://cli.github.com/\n" +
        "  Then run: gh auth login\n",
    );
    rl.close();
    process.exit(1);
  }

  const config = await loadConfig();

  // Step 1: Get the vault repo
  let vaultRepo = process.argv[2] || config.vaultRepo;

  if (!vaultRepo) {
    console.log(
      "Octopal stores your knowledge in a GitHub repo as Obsidian-compatible markdown.\n",
    );
    vaultRepo = await rl.question(
      "GitHub repo for your vault (e.g. username/vault): ",
    );
    vaultRepo = vaultRepo.trim();
    if (!vaultRepo) {
      console.error("Error: A GitHub repo is required.");
      rl.close();
      process.exit(1);
    }
  }

  // Step 2: Check if repo exists, create if it doesn't
  let repoExists = false;
  try {
    await exec("gh", ["repo", "view", vaultRepo, "--json", "name"]);
    repoExists = true;
    console.log(`✓ Found existing repo: ${vaultRepo}`);
  } catch {
    // Repo doesn't exist
  }

  if (!repoExists) {
    console.log(`\nRepo ${vaultRepo} doesn't exist yet. Creating it...\n`);
    const visibility = await rl.question(
      "Should the vault repo be private or public? [private]: ",
    );
    const flag = visibility.trim().toLowerCase() === "public" ? "--public" : "--private";
    try {
      await exec("gh", [
        "repo", "create", vaultRepo,
        flag,
        "--description", "Personal PARA knowledge vault managed by Octopal",
      ]);
      console.log(`✓ Created ${flag.slice(2)} repo: ${vaultRepo}\n`);
    } catch (err) {
      console.error(`Error creating repo: ${err}`);
      rl.close();
      process.exit(1);
    }
  }

  // Save config (use the HTTPS URL that gh provides auth for)
  const remoteUrl = `https://github.com/${vaultRepo}.git`;
  await saveConfig({ vaultRepo, vaultRemoteUrl: remoteUrl });
  console.log(`Config saved to ${config.configPath}`);
  console.log(`Vault will be at: ${config.vaultPath}\n`);

  // Initialize vault structure
  const vault = new VaultManager({
    localPath: config.vaultPath,
    remoteUrl: remoteUrl,
  });
  await vault.init();
  const para = new ParaManager(vault);
  await para.ensureStructure();

  // Copy templates if vault-template exists alongside this package
  const vaultTemplateDir = path.resolve(
    import.meta.dirname,
    "../../..",
    "vault-template",
  );
  const templateDir = path.join(vaultTemplateDir, "Templates");
  try {
    const templates = await fs.readdir(templateDir);
    for (const t of templates) {
      const content = await fs.readFile(path.join(templateDir, t), "utf-8");
      await vault.writeFile(`Templates/${t}`, content);
    }
  } catch {
    // vault-template not found — skip
  }

  // Copy default conventions file
  const conventionsSrc = path.join(vaultTemplateDir, ".octopal", "conventions.md");
  try {
    if (!(await vault.exists(".octopal/conventions.md"))) {
      const content = await fs.readFile(conventionsSrc, "utf-8");
      await vault.writeFile(".octopal/conventions.md", content);
    }
  } catch {
    // vault-template not found — skip
  }

  // Create knowledge base structure
  const knowledgeSrcDir = path.join(vaultTemplateDir, "Resources", "Knowledge");
  try {
    for (const subdir of ["People", "Terms", "Organizations", "Journal"]) {
      if (!(await vault.exists(`Resources/Knowledge/${subdir}`))) {
        await vault.writeFile(`Resources/Knowledge/${subdir}/.gitkeep`, "");
      }
    }
    // Copy README and PHILOSOPHY
    for (const file of ["README.md", "PHILOSOPHY.md"]) {
      if (!(await vault.exists(`Resources/Knowledge/${file}`))) {
        const content = await fs.readFile(path.join(knowledgeSrcDir, file), "utf-8");
        await vault.writeFile(`Resources/Knowledge/${file}`, content);
      }
    }
    // Copy Triage.md
    if (!(await vault.exists("Inbox/Triage.md"))) {
      const triageSrc = path.join(vaultTemplateDir, "Inbox", "Triage.md");
      const content = await fs.readFile(triageSrc, "utf-8");
      await vault.writeFile("Inbox/Triage.md", content);
    }
  } catch {
    // vault-template not found — skip
  }

  console.log("Vault structure created. Starting interactive setup...\n");
  console.log("─".repeat(60));
  console.log();

  // Start the Copilot agent with interactive user input
  const client = new CopilotClient({ logLevel: "warning" });
  await client.start();

  const vaultStructure = await para.getStructure();

  const tasks = new TaskManager();
  const vaultTools = buildCopilotTools({ vault, para, tasks });

  const session = await client.createSession({
    model: "claude-sonnet-4",
    workingDirectory: config.vaultPath,
    systemMessage: {
      mode: "append",
      content: `${SETUP_PROMPT}\n\n## Current Vault Structure\n\`\`\`\n${vaultStructure}\n\`\`\`\n\nToday's date: ${new Date().toISOString().slice(0, 10)}`,
    },
    onUserInputRequest: async (request) => {
      console.log();
      if (request.choices && request.choices.length > 0) {
        console.log(request.question);
        console.log();
        for (let i = 0; i < request.choices.length; i++) {
          console.log(`  ${i + 1}. ${request.choices[i]}`);
        }
        console.log();
        const answer = await rl.question("Your choice (number or type your answer): ");
        const choiceIndex = parseInt(answer, 10) - 1;
        if (choiceIndex >= 0 && choiceIndex < request.choices.length) {
          return {
            answer: request.choices[choiceIndex],
            wasFreeform: false,
          };
        }
        return { answer, wasFreeform: true };
      } else {
        const answer = await rl.question(`${request.question}\n\n> `);
        return { answer, wasFreeform: true };
      }
    },
    tools: [
      vaultTools.readVaultStructure,
      vaultTools.writeNote,
      vaultTools.appendToNote,
      vaultTools.commitChanges,
    ],
  });

  // Listen for assistant messages to print them
  session.on("assistant.message_delta", (event) => {
    process.stdout.write(event.data.deltaContent ?? "");
  });

  const response = await session.sendAndWait(
    {
      prompt:
        "Start the onboarding interview. Greet the user warmly and begin asking them about themselves to set up their vault. Use the ask_user tool for every question.",
    },
    600_000, // 10 minute timeout for the whole interview
  );

  console.log("\n");
  console.log("─".repeat(60));
  console.log("\n🐙 Your vault is ready!\n");
  console.log(`  📂 ${config.vaultPath}`);
  console.log(`  🔗 ${vaultRepo}`);
  console.log(
    `\n  Open ${config.vaultPath} in Obsidian to start using it.`,
  );
  console.log(
    `  Run 'octopal ingest \"your notes\"' to add content via the agent.\n`,
  );

  await session.destroy();
  await client.stop();
  rl.close();
}

main().catch((err) => {
  console.error("Error:", err);
  rl.close();
  process.exit(1);
});
