import { CopilotClient, CopilotSession, defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { VaultManager } from "./vault.js";
import { ParaManager, ParaCategory } from "./para.js";
import { TaskManager, type Task, TaskPriority } from "./tasks.js";
import type { OctopalConfig } from "./types.js";

const SYSTEM_PROMPT = `You are Octopal, a personal knowledge management assistant that implements the PARA method.

## The PARA Method
- **Projects**: Active efforts with a clear outcome and deadline (e.g., "Launch website", "Plan vacation")
- **Areas**: Ongoing responsibilities with no end date (e.g., "Health", "Finances", "Career")
- **Resources**: Topics of interest or reference material (e.g., "TypeScript", "Recipes", "Book notes")
- **Archives**: Completed or inactive items from the above categories

## Your Role
When the user gives you notes, brain dumps, transcripts, or other raw input:
1. Understand the content and extract key information
2. Decide where it belongs in the PARA structure
3. Create or update notes in the appropriate location
4. Extract any actionable items and create tasks using Obsidian Tasks format
5. Commit changes to the vault

## Obsidian Tasks Format
Create tasks using this emoji format:
- \`- [ ] Task description ⏫ 📅 2024-01-15 ➕ 2024-01-08\`
- Priority emojis: 🔺 (highest), ⏫ (high), 🔼 (medium), 🔽 (low), ⏬ (lowest)
- Date emojis: 📅 (due), 🛫 (start), ⏳ (scheduled), ➕ (created), ✅ (done)

## Guidelines
- Use Obsidian-compatible markdown (wikilinks like [[Note Name]] are fine)
- Add YAML frontmatter to new notes (title, created date, tags)
- Keep notes concise but complete
- When unsure where something belongs, put it in the Inbox
- Always include a created date (➕) on tasks
- Prefer creating notes in existing projects/areas when relevant
`;

export class OctopalAgent {
  private client: CopilotClient;
  private vault: VaultManager;
  private para: ParaManager;
  private tasks: TaskManager;

  constructor(private config: OctopalConfig) {
    this.client = new CopilotClient({
      logLevel: "warning",
    });
    this.vault = new VaultManager(config.vault);
    this.para = new ParaManager(this.vault);
    this.tasks = new TaskManager();
  }

  async init(): Promise<void> {
    await this.client.start();
    await this.vault.init();
    await this.para.ensureStructure();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async createSession(): Promise<CopilotSession> {
    const vaultStructure = await this.para.getStructure();

    const session = await this.client.createSession({
      model: "claude-sonnet-4",
      workingDirectory: this.vault.root,
      systemMessage: {
        mode: "append",
        content: `${SYSTEM_PROMPT}\n\n## Current Vault Structure\n\`\`\`\n${vaultStructure}\n\`\`\``,
      },
      tools: this.buildTools(),
    });

    return session;
  }

  /** Send a prompt and wait for the agent to finish processing */
  async sendAndWait(
    session: CopilotSession,
    prompt: string,
    timeout = 300_000,
  ): Promise<string> {
    const response = await session.sendAndWait({ prompt }, timeout);
    return response?.data?.content ?? "";
  }

  /** One-shot: create a session, send a prompt, get a response, clean up */
  async run(prompt: string): Promise<string> {
    const session = await this.createSession();
    try {
      return await this.sendAndWait(session, prompt);
    } finally {
      await session.destroy();
    }
  }

  private buildTools() {
    return [
      defineTool("read_vault_structure", {
        description:
          "List the PARA vault categories and their contents (projects, areas, resources, archives, inbox)",
        parameters: z.object({}),
        handler: async () => {
          const structure = await this.para.getStructure();
          return structure;
        },
      }),

      defineTool("read_note", {
        description: "Read the contents of a note in the vault by its relative path",
        parameters: z.object({
          path: z.string().describe("Relative path to the note, e.g. 'Projects/my-project/index.md'"),
        }),
        handler: async ({ path }) => {
          return await this.vault.readFile(path);
        },
      }),

      defineTool("write_note", {
        description:
          "Create or overwrite a markdown note in the vault. Use for new notes or full rewrites.",
        parameters: z.object({
          path: z
            .string()
            .describe("Relative path for the note, e.g. 'Projects/my-project/research.md'"),
          content: z.string().describe("Full markdown content of the note"),
        }),
        handler: async ({ path, content }) => {
          await this.vault.writeFile(path, content);
          return `Wrote note to ${path}`;
        },
      }),

      defineTool("append_to_note", {
        description:
          "Append content to the end of an existing note. Creates the note if it doesn't exist.",
        parameters: z.object({
          path: z.string().describe("Relative path to the note"),
          content: z.string().describe("Content to append"),
        }),
        handler: async ({ path, content }) => {
          await this.vault.appendToFile(path, content);
          return `Appended to ${path}`;
        },
      }),

      defineTool("create_task", {
        description:
          "Create a task in Obsidian Tasks emoji format and append it to a note",
        parameters: z.object({
          notePath: z.string().describe("Path to the note to add the task to"),
          description: z.string().describe("Task description"),
          dueDate: z.string().optional().describe("Due date in YYYY-MM-DD format"),
          startDate: z.string().optional().describe("Start date in YYYY-MM-DD format"),
          priority: z
            .enum(["highest", "high", "medium", "normal", "low", "lowest"])
            .optional()
            .describe("Task priority"),
        }),
        handler: async ({ notePath, description, dueDate, startDate, priority }) => {
          const priorityMap: Record<string, TaskPriority> = {
            highest: TaskPriority.Highest,
            high: TaskPriority.High,
            medium: TaskPriority.Medium,
            normal: TaskPriority.Normal,
            low: TaskPriority.Low,
            lowest: TaskPriority.Lowest,
          };
          const taskLine = this.tasks.create(description, {
            dueDate,
            startDate,
            priority: priorityMap[priority ?? "normal"],
          });
          await this.vault.appendToFile(notePath, taskLine);
          return `Created task: ${taskLine}`;
        },
      }),

      defineTool("search_vault", {
        description: "Full-text search across all markdown files in the vault",
        parameters: z.object({
          query: z.string().describe("Search query (case-insensitive)"),
        }),
        handler: async ({ query }) => {
          const results = await this.vault.search(query);
          if (results.length === 0) return "No results found.";
          return results
            .slice(0, 20)
            .map((r) => `${r.path}: ${r.line}`)
            .join("\n");
        },
      }),

      defineTool("list_category", {
        description: "List items in a PARA category",
        parameters: z.object({
          category: z
            .enum(["Projects", "Areas", "Resources", "Archives", "Inbox"])
            .describe("PARA category to list"),
        }),
        handler: async ({ category }) => {
          const items = await this.para.listCategory(category as ParaCategory);
          return items.length > 0 ? items.join("\n") : "(empty)";
        },
      }),

      defineTool("move_item", {
        description:
          "Move a note or folder from one PARA category to another (e.g., archive a completed project)",
        parameters: z.object({
          from: z
            .enum(["Projects", "Areas", "Resources", "Archives", "Inbox"])
            .describe("Source PARA category"),
          to: z
            .enum(["Projects", "Areas", "Resources", "Archives", "Inbox"])
            .describe("Destination PARA category"),
          itemName: z.string().describe("Name of the item (folder or file) to move"),
        }),
        handler: async ({ from, to, itemName }) => {
          await this.para.moveItem(from as ParaCategory, to as ParaCategory, itemName);
          return `Moved ${itemName} from ${from} to ${to}`;
        },
      }),

      defineTool("commit_changes", {
        description:
          "Commit all pending changes in the vault to git and push to the remote",
        parameters: z.object({
          message: z.string().describe("Git commit message"),
        }),
        handler: async ({ message }) => {
          await this.vault.commitAndPush(message);
          return `Committed and pushed: ${message}`;
        },
      }),
    ];
  }
}
