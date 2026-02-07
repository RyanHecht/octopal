#!/usr/bin/env node

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CopilotClient, defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import {
  VaultManager,
  ParaManager,
  loadConfig,
  saveConfig,
} from "@octopal/core";

const exec = promisify(execFile);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const SYSTEM_PROMPT = `You are the Octopal onboarding assistant. Your job is to help someone set up their personal PARA vault by having a friendly, conversational interview.

## Your Goal
Learn enough about the user to pre-populate their vault with a useful starting structure. You want to understand:
1. Their name and basic info (for personalizing the vault)
2. Their current active projects (things with deadlines/outcomes)
3. Their ongoing areas of responsibility (health, finances, career, relationships, hobbies, etc.)
4. Topics they're interested in or want to track as resources
5. Any immediate tasks or todos they have on their mind

## How to Conduct the Interview
- Be warm, conversational, and encouraging — this should feel easy, not like filling out a form
- Ask ONE question at a time using the ask_user tool
- Start broad ("Tell me about yourself") then get specific ("What projects are you working on?")
- When asking about projects/areas/resources, give examples to help them think
- After each answer, acknowledge what they said and ask a natural follow-up
- Don't ask more than 8-10 questions total — keep it moving
- It's okay if answers are brief; you can infer structure from casual descriptions

## After the Interview
Once you have enough context:
1. Create an "About Me" note in the vault root with their biographical info
2. Create project folders with index.md for each active project they mentioned
3. Create area folders with index.md for each area of responsibility
4. Create resource folders for topics of interest
5. Add any immediate tasks they mentioned to the relevant project/area notes
6. Commit everything with a descriptive message

## PARA Categories Explained (for your reference)
- **Projects**: Active efforts with a clear outcome (has an end state)
- **Areas**: Ongoing responsibilities you maintain over time (no end date)
- **Resources**: Topics of interest, reference material, things you want to learn about
- **Archives**: (don't create any during onboarding)

## Task Format
Use Obsidian Tasks emoji format:
\`- [ ] Task description ➕ YYYY-MM-DD\`
Add priority emojis (⏫ high, 🔼 medium) and due dates (📅) when the user mentions urgency/deadlines.

## Note Format
Always include YAML frontmatter:
\`\`\`markdown
---
title: "Note Title"
created: YYYY-MM-DDTHH:MM:SS
tags: [relevant, tags]
---
\`\`\`
`;

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
  const templateDir = path.resolve(
    import.meta.dirname,
    "../../..",
    "vault-template",
    "Templates",
  );
  try {
    const templates = await fs.readdir(templateDir);
    for (const t of templates) {
      const content = await fs.readFile(path.join(templateDir, t), "utf-8");
      await vault.writeFile(`Templates/${t}`, content);
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

  const session = await client.createSession({
    model: "claude-sonnet-4",
    workingDirectory: config.vaultPath,
    systemMessage: {
      mode: "append",
      content: `${SYSTEM_PROMPT}\n\n## Current Vault Structure\n\`\`\`\n${vaultStructure}\n\`\`\`\n\nToday's date: ${new Date().toISOString().slice(0, 10)}`,
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
      defineTool("read_vault_structure", {
        description: "List the current vault structure",
        parameters: z.object({}),
        handler: async () => para.getStructure(),
      }),

      defineTool("write_note", {
        description:
          "Create or overwrite a markdown note in the vault",
        parameters: z.object({
          path: z.string().describe("Relative path, e.g. 'Projects/my-project/index.md'"),
          content: z.string().describe("Full markdown content including frontmatter"),
        }),
        handler: async ({ path: notePath, content }) => {
          await vault.writeFile(notePath, content);
          return `Created: ${notePath}`;
        },
      }),

      defineTool("append_to_note", {
        description: "Append content to an existing note",
        parameters: z.object({
          path: z.string().describe("Relative path to the note"),
          content: z.string().describe("Content to append"),
        }),
        handler: async ({ path: notePath, content }) => {
          await vault.appendToFile(notePath, content);
          return `Appended to: ${notePath}`;
        },
      }),

      defineTool("commit_changes", {
        description: "Commit all changes to git",
        parameters: z.object({
          message: z.string().describe("Git commit message"),
        }),
        handler: async ({ message }) => {
          await vault.commitAndPush(message);
          return `Committed: ${message}`;
        },
      }),
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
