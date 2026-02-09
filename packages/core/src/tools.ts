import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import type { ZodObject } from "zod";
import type { VaultManager } from "./vault.js";
import { type ParaManager, ParaCategory } from "./para.js";
import { type TaskManager, TaskPriority } from "./tasks.js";

export interface ToolDeps {
  vault: VaultManager;
  para: ParaManager;
  tasks: TaskManager;
}

/** Harness-agnostic tool definition — consumable by Copilot SDK, MCP, etc. */
export interface OctopalToolDef<T = unknown> {
  name: string;
  description: string;
  parameters: ZodObject<any>;
  handler: (args: T) => Promise<string>;
}

/** Core vault tools as harness-agnostic definitions */
export function buildVaultTools({ vault, para, tasks }: ToolDeps): Record<string, OctopalToolDef> {
  return {
    readVaultStructure: {
      name: "read_vault_structure",
      description:
        "List the PARA vault categories and their contents (projects, areas, resources, archives, inbox)",
      parameters: z.object({}),
      handler: async () => {
        return await para.getStructure();
      },
    },

    readNote: {
      name: "read_note",
      description: "Read the contents of a note in the vault by its relative path",
      parameters: z.object({
        path: z.string().describe("Relative path to the note, e.g. 'Projects/my-project/index.md'"),
      }),
      handler: async ({ path }: any) => {
        return await vault.readFile(path);
      },
    },

    writeNote: {
      name: "write_note",
      description:
        "Create or overwrite a markdown note in the vault. Use for new notes or full rewrites.",
      parameters: z.object({
        path: z
          .string()
          .describe("Relative path for the note, e.g. 'Projects/my-project/research.md'"),
        content: z.string().describe("Full markdown content of the note"),
      }),
      handler: async ({ path, content }: any) => {
        await vault.writeFile(path, content);
        return `Wrote note to ${path}`;
      },
    },

    appendToNote: {
      name: "append_to_note",
      description:
        "Append content to the end of an existing note. Creates the note if it doesn't exist.",
      parameters: z.object({
        path: z.string().describe("Relative path to the note"),
        content: z.string().describe("Content to append"),
      }),
      handler: async ({ path, content }: any) => {
        await vault.appendToFile(path, content);
        return `Appended to ${path}`;
      },
    },

    createTask: {
      name: "create_task",
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
      handler: async ({ notePath, description, dueDate, startDate, priority }: any) => {
        const priorityMap: Record<string, TaskPriority> = {
          highest: TaskPriority.Highest,
          high: TaskPriority.High,
          medium: TaskPriority.Medium,
          normal: TaskPriority.Normal,
          low: TaskPriority.Low,
          lowest: TaskPriority.Lowest,
        };
        const taskLine = tasks.create(description, {
          dueDate,
          startDate,
          priority: priorityMap[priority ?? "normal"],
        });
        await vault.appendToFile(notePath, taskLine);
        return `Created task: ${taskLine}`;
      },
    },

    searchVault: {
      name: "search_vault",
      description: "Full-text search across all markdown files in the vault",
      parameters: z.object({
        query: z.string().describe("Search query (case-insensitive)"),
      }),
      handler: async ({ query }: any) => {
        const results = await vault.search(query);
        if (results.length === 0) return "No results found.";
        return results
          .slice(0, 20)
          .map((r) => `${r.path}: ${r.line}`)
          .join("\n");
      },
    },

    listCategory: {
      name: "list_category",
      description: "List items in a PARA category",
      parameters: z.object({
        category: z
          .enum(["Projects", "Areas", "Resources", "Archives", "Inbox"])
          .describe("PARA category to list"),
      }),
      handler: async ({ category }: any) => {
        const items = await para.listCategory(category as ParaCategory);
        return items.length > 0 ? items.join("\n") : "(empty)";
      },
    },

    moveItem: {
      name: "move_item",
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
      handler: async ({ from, to, itemName }: any) => {
        await para.moveItem(from as ParaCategory, to as ParaCategory, itemName);
        return `Moved ${itemName} from ${from} to ${to}`;
      },
    },

    commitChanges: {
      name: "commit_changes",
      description:
        "Commit all pending changes in the vault to git and push to the remote",
      parameters: z.object({
        message: z.string().describe("Git commit message"),
      }),
      handler: async ({ message }: any) => {
        await vault.commitAndPush(message);
        return `Committed and pushed: ${message}`;
      },
    },

    lookupKnowledge: {
      name: "lookup_knowledge",
      description:
        "Search the knowledge base (Resources/Knowledge/) for people, terms, or organizations. Use as a fallback if the provided knowledge context is missing something.",
      parameters: z.object({
        query: z.string().describe("Search query (case-insensitive)"),
      }),
      handler: async ({ query }: any) => {
        const results = await vault.search(query);
        const kbResults = results.filter((r) =>
          r.path.startsWith("Resources/Knowledge/"),
        );
        if (kbResults.length === 0) return "No knowledge entries found.";
        return kbResults
          .slice(0, 15)
          .map((r) => `${r.path}: ${r.line}`)
          .join("\n");
      },
    },

    saveKnowledge: {
      name: "save_knowledge",
      description:
        "Create or update a knowledge entry in Resources/Knowledge/. Use when you discover a new person, organization, term, or other reusable fact.",
      parameters: z.object({
        category: z
          .enum(["People", "Terms", "Organizations"])
          .describe("Knowledge category"),
        name: z.string().describe("Entity name, e.g. 'Dr. Chen'"),
        content: z
          .string()
          .describe("Markdown body (details, contact info, notes — no frontmatter)"),
        aliases: z
          .array(z.string())
          .optional()
          .describe("Alternative names/terms for this entity"),
      }),
      handler: async ({ category, name, content, aliases }: any) => {
        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        const filePath = `Resources/Knowledge/${category}/${slug}.md`;
        const today = new Date().toISOString().slice(0, 10);
        const aliasLine =
          aliases && aliases.length > 0
            ? `\naliases: [${aliases.join(", ")}]`
            : "";
        const frontmatter = `---\ntitle: "${name}"${aliasLine}\ncategory: ${category.toLowerCase()}\ncreated: ${today}\n---\n\n`;
        await vault.writeFile(filePath, frontmatter + content);
        return `Saved knowledge entry: ${filePath}`;
      },
    },

    addTriageItem: {
      name: "add_triage_item",
      description:
        "Add an uncertain association or new entity suggestion to the triage queue (Inbox/Triage.md) for the user to review. Use when you're not confident about a knowledge link.",
      parameters: z.object({
        description: z
          .string()
          .describe(
            'What needs review, e.g. \'"my shrink" → alias for Dr. Chen?\'',
          ),
        context: z
          .string()
          .describe("The surrounding text that prompted this suggestion"),
        suggestedMatch: z
          .string()
          .optional()
          .describe("Path to the suggested knowledge entry, if applicable"),
        confidence: z
          .string()
          .optional()
          .describe("Confidence level, e.g. '70%'"),
      }),
      handler: async ({
        description: desc,
        context,
        suggestedMatch,
        confidence,
      }: any) => {
        const triagePath = "Inbox/Triage.md";

        // Read existing triage file or create with header
        let existing = "";
        try {
          existing = await vault.readFile(triagePath);
        } catch {
          existing = `# Triage Queue\n\nReview pending associations. Mark with ✅ to approve, ❌ to reject,\nor edit the suggestion. Run \`octopal triage\` to process your decisions.\n\n## Pending\n\n## Processed\n`;
        }

        // Deduplicate — skip if same description already pending
        if (existing.includes(desc)) {
          return `Triage item already exists: ${desc}`;
        }

        // Build the new item
        let item = `- [ ] ${desc}`;
        item += `\n  _Context: "${context}"_`;
        if (confidence) item += `\n  _Confidence: ${confidence}_`;
        if (suggestedMatch) item += `\n  _Suggested: ${suggestedMatch}_`;
        item += "\n";

        // Insert before "## Processed" section
        const processedIdx = existing.indexOf("## Processed");
        if (processedIdx !== -1) {
          const before = existing.slice(0, processedIdx);
          const after = existing.slice(processedIdx);
          await vault.writeFile(triagePath, before + item + "\n" + after);
        } else {
          await vault.appendToFile(triagePath, item);
        }

        return `Added triage item: ${desc}`;
      },
    },
  };
}

/** Wrap a single OctopalToolDef as a Copilot SDK tool */
function toCopilotTool(def: OctopalToolDef) {
  return defineTool(def.name, {
    description: def.description,
    parameters: def.parameters,
    handler: def.handler,
  });
}

/** Return all vault tools wrapped for the Copilot SDK, keyed by name */
export function buildCopilotTools(deps: ToolDeps) {
  const raw = buildVaultTools(deps);
  const result: Record<string, ReturnType<typeof toCopilotTool>> = {};
  for (const [key, def] of Object.entries(raw)) {
    result[key] = toCopilotTool(def);
  }
  return result;
}

/** Return all vault tools as a Copilot SDK array */
export function buildAllVaultTools(deps: ToolDeps) {
  return Object.values(buildCopilotTools(deps));
}
