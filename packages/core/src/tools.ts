import { defineTool } from "@github/copilot-sdk";
import type { CopilotClient } from "@github/copilot-sdk";
import { z } from "zod";
import type { VaultManager } from "./vault.js";
import { type ParaManager, ParaCategory } from "./para.js";
import { type TaskManager, TaskPriority } from "./tasks.js";
import { runPreprocessor } from "./preprocessor.js";

export interface ToolDeps {
  vault: VaultManager;
  para: ParaManager;
  tasks: TaskManager;
  client: CopilotClient;
}

/** Build all vault tools as Copilot SDK Tool objects */
export function buildVaultTools({ vault, para, tasks, client }: ToolDeps) {
  return [
    defineTool("analyze_input", {
      description:
        "Analyze raw input text against the knowledge base. Runs deterministic and semantic matching to find relevant knowledge entries, identify uncertain associations, and discover new entities. Call this BEFORE processing raw notes, brain dumps, or transcripts.",
      parameters: z.object({
        text: z.string().describe("The raw input text to analyze"),
      }),
      handler: async ({ text }: any) => {
        const preprocessed = await runPreprocessor(client, vault, text);

        // Auto-apply high-confidence aliases
        for (const { knowledgePath, alias } of preprocessed.newAliases) {
          try {
            const content = await vault.readFile(knowledgePath);
            const aliasMatch = content.match(/^aliases:\s*\[([^\]]*)\]/m);
            if (aliasMatch) {
              const existing = aliasMatch[1];
              const newAliases = existing ? `${existing}, ${alias}` : alias;
              const updated = content.replace(aliasMatch[0], `aliases: [${newAliases}]`);
              await vault.writeFile(knowledgePath, updated);
            } else {
              const updated = content.replace(/^(title:.*\n)/m, `$1aliases: [${alias}]\n`);
              await vault.writeFile(knowledgePath, updated);
            }
          } catch {
            // Skip if file can't be read/written
          }
        }

        // Format results for the agent
        const sections: string[] = [];

        if (preprocessed.matched.length > 0) {
          sections.push("## Relevant Knowledge Context\n");
          for (const entry of preprocessed.matched) {
            sections.push(`### ${entry.path}\n\`\`\`\n${entry.content}\n\`\`\``);
          }
        }

        if (preprocessed.triageItems.length > 0) {
          sections.push("\n## Uncertain Associations\nUse ⚠️ links and add_triage_item for these:");
          for (const item of preprocessed.triageItems) {
            sections.push(`- "${item.text}" might refer to ${item.suggestedMatch ?? "unknown"} (${item.reasoning})`);
          }
        }

        if (preprocessed.newEntities.length > 0) {
          sections.push("\n## New Entities to Save\nUse save_knowledge to create entries:");
          for (const entity of preprocessed.newEntities) {
            sections.push(`- **${entity.name}** (${entity.categoryHint}): "${entity.context}"`);
          }
        }

        if (sections.length === 0) {
          return "No relevant knowledge context found. Proceed with processing the input.";
        }

        if (preprocessed.newAliases.length > 0) {
          sections.push(`\n(Auto-applied ${preprocessed.newAliases.length} new alias(es) to knowledge entries)`);
        }

        return sections.join("\n");
      },
    }),

    defineTool("read_vault_structure", {
      description:
        "List the PARA vault categories and their contents (projects, areas, resources, archives, inbox)",
      parameters: z.object({}),
      handler: async () => {
        return await para.getStructure();
      },
    }),

    defineTool("read_note", {
      description: "Read the contents of a note in the vault by its relative path",
      parameters: z.object({
        path: z.string().describe("Relative path to the note, e.g. 'Projects/my-project/index.md'"),
      }),
      handler: async ({ path }: any) => {
        return await vault.readFile(path);
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
      handler: async ({ path, content }: any) => {
        await vault.writeFile(path, content);
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
      handler: async ({ path, content }: any) => {
        await vault.appendToFile(path, content);
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
    }),

    defineTool("search_vault", {
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
    }),

    defineTool("list_category", {
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
      handler: async ({ from, to, itemName }: any) => {
        await para.moveItem(from as ParaCategory, to as ParaCategory, itemName);
        return `Moved ${itemName} from ${from} to ${to}`;
      },
    }),

    defineTool("commit_changes", {
      description:
        "Commit all pending changes in the vault to git and push to the remote",
      parameters: z.object({
        message: z.string().describe("Git commit message"),
      }),
      handler: async ({ message }: any) => {
        await vault.commitAndPush(message);
        return `Committed and pushed: ${message}`;
      },
    }),

    defineTool("lookup_knowledge", {
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
    }),

    defineTool("save_knowledge", {
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
    }),

    defineTool("add_triage_item", {
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

        let existing = "";
        try {
          existing = await vault.readFile(triagePath);
        } catch {
          existing = `# Triage Queue\n\nReview pending associations. Mark with ✅ to approve, ❌ to reject,\nor edit the suggestion. Run \`octopal triage\` to process your decisions.\n\n## Pending\n\n## Processed\n`;
        }

        if (existing.includes(desc)) {
          return `Triage item already exists: ${desc}`;
        }

        let item = `- [ ] ${desc}`;
        item += `\n  _Context: "${context}"_`;
        if (confidence) item += `\n  _Confidence: ${confidence}_`;
        if (suggestedMatch) item += `\n  _Suggested: ${suggestedMatch}_`;
        item += "\n";

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
    }),
  ];
}
