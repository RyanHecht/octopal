import { defineTool } from "@github/copilot-sdk";
import type { CopilotClient } from "@github/copilot-sdk";
import { z } from "zod";
import * as TOML from "smol-toml";
import type { VaultManager } from "./vault.js";
import { type ParaManager, ParaCategory } from "./para.js";
import { type TaskManager, TaskPriority } from "./tasks.js";
import { runPreprocessor } from "./preprocessor.js";
import { addAliasToEntry, getCachedAliasLookup, invalidateAliasCache, normalize, quoteAlias } from "./knowledge.js";
import type { Scheduler } from "./scheduler.js";
import { toCron } from "./schedule-types.js";
import type { ConnectorRegistryLike } from "./types.js";
import { QmdSearch, scopeToCollections, type SearchScope } from "./qmd.js";
import type { BackgroundTaskManager } from "./background-tasks.js";
import { createLogger } from "./log.js";

const log = createLogger("tools");

export interface ToolDeps {
  vault: VaultManager;
  para: ParaManager;
  tasks: TaskManager;
  client: CopilotClient;
  scheduler?: Scheduler;
  connectors?: ConnectorRegistryLike;
  qmd?: QmdSearch;
  backgroundTasks?: BackgroundTaskManager;
  /** Agent reference for background task spawning (avoids circular import) */
  getAgent?: () => import("./agent.js").OctopalAgent;
}

/** Build all vault tools as Copilot SDK Tool objects */
export function buildVaultTools({ vault, para, tasks, client, scheduler, connectors, qmd, backgroundTasks, getAgent }: ToolDeps) {
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
          await addAliasToEntry(vault, knowledgePath, alias);
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
      description:
        "Search across the vault using keyword or semantic search. Use proactively to find relevant context and to check for existing entries before creating new ones. Use the scope parameter to target specific areas: 'all' (default) searches knowledge entries + working notes, 'knowledge' for people/terms/organizations only, 'notes' for projects/areas/resources only, 'sessions' for past conversation logs, 'deep' for high-quality hybrid search with reranking (slower but better for complex queries).",
      parameters: z.object({
        query: z.string().describe("Search query — keywords or natural language"),
        scope: z
          .enum(["all", "knowledge", "notes", "sessions", "deep"])
          .optional()
          .describe("Search scope (default: 'all' = knowledge + notes)"),
      }),
      handler: async ({ query, scope: rawScope }: any) => {
        const scope: SearchScope = rawScope ?? "all";

        // Try QMD first
        if (qmd && (await qmd.isAvailable())) {
          const collections = scopeToCollections(scope);
          const results =
            scope === "deep"
              ? await qmd.deepSearch(query, collections)
              : await qmd.search(query, collections);

          if (results.length === 0) return "No results found.";
          return results
            .map((r) => {
              let line = `**${r.path}** (score: ${r.score.toFixed(2)})`;
              if (r.snippet) line += `\n  ${r.snippet}`;
              return line;
            })
            .join("\n\n");
        }

        // Fallback to substring search
        const results = await vault.search(query);
        const filtered =
          scope === "knowledge"
            ? results.filter((r) => r.path.startsWith("Resources/Knowledge/"))
            : scope === "sessions"
              ? results.filter((r) => r.path.startsWith("Resources/Session Logs/"))
              : scope === "notes"
                ? results.filter(
                    (r) =>
                      !r.path.startsWith("Resources/Knowledge/") &&
                      !r.path.startsWith("Resources/Session Logs/"),
                  )
                : results;

        if (filtered.length === 0) return "No results found.";
        return filtered
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
        // Trigger background reindex so search stays fresh
        qmd?.reindex();
        return `Committed and pushed: ${message}`;
      },
    }),

    defineTool("save_knowledge", {
      description:
        "Create a knowledge entry in Resources/Knowledge/. IMPORTANT: The system will automatically check if this entity already exists — if it does, you'll get the existing content back. In that case, use write_note to update the existing entry instead of creating a duplicate.",
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
        // Check for existing entry with same name/alias (programmatic duplicate prevention)
        const lookup = await getCachedAliasLookup(vault);
        const normalizedName = normalize(name);
        const existingPaths = lookup.lookup.get(normalizedName);
        if (existingPaths && existingPaths.length > 0) {
          const existingPath = existingPaths[0];
          try {
            const existingContent = await vault.readFile(existingPath);
            return `Entry already exists at ${existingPath}. Current content:\n\`\`\`\n${existingContent}\n\`\`\`\nUse write_note to update it with merged content.`;
          } catch (e) {
            log.warn(`Failed to read existing entry ${existingPath}`, e);
            return `Entry already exists at ${existingPath}. Use read_note + write_note to update it.`;
          }
        }

        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        const filePath = `Resources/Knowledge/${category}/${slug}.md`;
        const today = new Date().toISOString().slice(0, 10);
        const aliasLine =
          aliases && aliases.length > 0
            ? `\naliases: [${aliases.map((a: string) => quoteAlias(a)).join(", ")}]`
            : "";
        const frontmatter = `---\ntitle: "${name}"${aliasLine}\ncategory: ${category.toLowerCase()}\ncreated: ${today}\n---\n\n`;
        await vault.writeFile(filePath, frontmatter + content);
        invalidateAliasCache();  // After write so concurrent reads don't miss the file
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

    // ── Scheduler tools ──────────────────────────────────────────────

    defineTool("schedule_task", {
      description:
        "Create a scheduled task that runs a prompt on a recurring schedule or at a specific one-off time. The schedule is persisted to the vault.",
      parameters: z.object({
        name: z.string().describe("Human-readable name for the task"),
        prompt: z.string().describe("The prompt to send to the agent when the task runs"),
        schedule: z.string().optional().describe("Cron expression (e.g. '0 9 * * MON-FRI') or interval sugar ('daily', 'hourly', 'every 30m'). Required for recurring tasks."),
        once: z.string().optional().describe("ISO 8601 datetime for a one-off task (e.g. '2026-02-14T09:00:00'). Mutually exclusive with schedule."),
        skill: z.string().optional().describe("Optional skill name to target"),
      }),
      handler: async ({ name, prompt, schedule, once, skill }: any) => {
        if (!schedule && !once) {
          return "Error: provide either 'schedule' (recurring) or 'once' (one-off).";
        }

        // Validate cron/interval if provided
        if (schedule) {
          try {
            toCron(schedule);
          } catch (err) {
            return `Error: invalid schedule "${schedule}": ${err instanceof Error ? err.message : err}`;
          }
        }

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const filePath = `Meta/schedules/${slug}.toml`;

        const def: Record<string, unknown> = { name, prompt };
        if (schedule) def.schedule = schedule;
        if (once) def.once = once;
        if (skill) def.skill = skill;

        await vault.writeFile(filePath, TOML.stringify(def) + "\n");

        if (scheduler) await scheduler.reload();

        return `Scheduled task "${name}" saved to ${filePath}`;
      },
    }),

    defineTool("cancel_scheduled_task", {
      description:
        "Cancel and remove a scheduled task by its ID (the filename without .toml extension). Builtin tasks cannot be cancelled.",
      parameters: z.object({
        taskId: z.string().describe("The task ID to cancel (e.g. 'daily-digest')"),
      }),
      handler: async ({ taskId }: any) => {
        if (scheduler) {
          const task = scheduler.listTasks().find((t) => t.id === taskId);
          if (!task) return `No scheduled task found with ID "${taskId}".`;
          if (task.builtin) return `Cannot cancel builtin task "${task.name}".`;
        }

        const filePath = `Meta/schedules/${taskId}.toml`;
        try {
          await vault.deleteFile(filePath);
        } catch {
          return `No schedule file found for "${taskId}".`;
        }

        if (scheduler) await scheduler.reload();

        return `Cancelled and removed scheduled task "${taskId}".`;
      },
    }),

    defineTool("list_scheduled_tasks", {
      description: "List all active scheduled tasks (both recurring and one-off, including builtins)",
      parameters: z.object({}),
      handler: async () => {
        if (!scheduler) {
          return "Scheduler is not available (server not running).";
        }

        const tasks = scheduler.listTasks();
        if (tasks.length === 0) return "No scheduled tasks.";

        return tasks.map((t) => {
          const type = t.once ? `once: ${t.once}` : `schedule: ${t.schedule}`;
          const flags = [
            t.builtin ? "builtin" : null,
            !t.enabled ? "disabled" : null,
          ].filter(Boolean).join(", ");
          const flagStr = flags ? ` (${flags})` : "";
          return `- **${t.name}** [${t.id}] — ${type}${flagStr}`;
        }).join("\n");
      },
    }),

    // ── Connector tools ──────────────────────────────────────────────

    defineTool("list_connectors", {
      description:
        "List all connected remote devices/connectors and their capabilities. Use this to check what machines are online and what they can do.",
      parameters: z.object({}),
      handler: async () => {
        if (!connectors) {
          return "Connector registry is not available (server not running).";
        }

        const list = connectors.list();
        if (list.length === 0) return "No remote connectors are currently connected.";

        return list.map((c) => {
          const caps = c.capabilities.length > 0 ? c.capabilities.join(", ") : "none";
          const meta = Object.keys(c.metadata).length > 0
            ? ` (${Object.entries(c.metadata).map(([k, v]) => `${k}: ${v}`).join(", ")})`
            : "";
          return `- **${c.name}**: ${caps}${meta}`;
        }).join("\n");
      },
    }),

    defineTool("remote_execute", {
      description:
        "Execute a shell command on a remote connected machine. The connector must have the 'shell' capability. Use this to run CLI tools, scripts, or capture data from remote devices.",
      parameters: z.object({
        connector: z.string().describe("Name of the target connector (e.g. 'work-mac', 'linux-desktop')"),
        command: z.string().describe("Shell command to execute on the remote machine"),
        timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 60000)"),
      }),
      handler: async ({ connector: connectorName, command, timeoutMs }: any) => {
        if (!connectors) {
          return "Error: Connector registry is not available (server not running).";
        }

        try {
          const result = await connectors.sendRequest(
            connectorName,
            "shell",
            "execute",
            { command },
            timeoutMs,
          ) as { stdout?: string; stderr?: string; exitCode?: number };

          const sections: string[] = [];
          if (result.stdout) sections.push(result.stdout);
          if (result.stderr) sections.push(`STDERR:\n${result.stderr}`);
          if (result.exitCode !== undefined && result.exitCode !== 0) {
            sections.push(`Exit code: ${result.exitCode}`);
          }
          return sections.length > 0 ? sections.join("\n") : "(no output)";
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    // ── Background task tools ────────────────────────────────────────

    defineTool("spawn_background_task", {
      description:
        "Spawn a long-running task in a background agent session. Use for tasks that would block the conversation: multi-step research, repo cloning, code generation across multiple files, competitive analysis, etc. The task runs independently and results are delivered when complete.",
      parameters: z.object({
        task: z.string().describe("Detailed description of the task to perform"),
        label: z.string().optional().describe("Short human-readable label for the task (e.g. 'Research competitors')"),
      }),
      handler: async ({ task, label }: any, context: any) => {
        if (!backgroundTasks || !getAgent) {
          return "Error: Background tasks are not available (server not running).";
        }

        const sessionId = context?.sessionId ?? "unknown";
        try {
          const runId = await backgroundTasks.spawn(getAgent(), {
            task,
            label,
            requesterSessionId: sessionId,
          });
          return `Background task spawned (ID: ${runId}). Label: "${label ?? task.slice(0, 50)}". You'll receive results when it completes.`;
        } catch (err) {
          return `Error spawning background task: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    defineTool("list_background_tasks", {
      description:
        "List all background tasks and their statuses (running, completed, failed)",
      parameters: z.object({}),
      handler: async (_args: any, context: any) => {
        if (!backgroundTasks) {
          return "Error: Background tasks are not available (server not running).";
        }

        const runs = backgroundTasks.list();
        if (runs.length === 0) return "No background tasks.";

        return runs.map((r) => {
          const elapsed = ((r.endedAt ?? Date.now()) - r.startedAt) / 1000;
          let line = `- **${r.label ?? r.task.slice(0, 50)}** [${r.runId.slice(0, 8)}] — ${r.status} (${elapsed.toFixed(0)}s)`;
          if (r.status === "failed" && r.error) line += `\n  Error: ${r.error}`;
          return line;
        }).join("\n");
      },
    }),

    defineTool("kill_background_task", {
      description: "Kill a running background task by its ID",
      parameters: z.object({
        runId: z.string().describe("The task ID to kill (from list_background_tasks)"),
      }),
      handler: async ({ runId }: any) => {
        if (!backgroundTasks) {
          return "Error: Background tasks are not available (server not running).";
        }

        const killed = backgroundTasks.kill(runId);
        return killed
          ? `Background task ${runId.slice(0, 8)} killed.`
          : `No running background task found with ID ${runId.slice(0, 8)}.`;
      },
    }),
  ];
}
