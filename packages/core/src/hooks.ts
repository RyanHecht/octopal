import type { CopilotClient, SessionConfig, ToolResultObject } from "@github/copilot-sdk";
import type { VaultManager } from "./vault.js";
import type { QmdSearch } from "./qmd.js";
import type { SessionLogger } from "./session-logger.js";
import type { BackgroundTaskManager } from "./background-tasks.js";
import { runPreprocessor, type PreprocessorResult } from "./preprocessor.js";
import { deterministicMatch, buildKnowledgeIndex } from "./knowledge.js";

/** Extract the SessionHooks type from SessionConfig */
type SessionHooks = NonNullable<SessionConfig["hooks"]>;

/** Quote an alias for safe insertion into YAML inline arrays */
function quoteAlias(alias: string): string {
  if (/[,:\[\]'"#{}|>&*!?@`]/.test(alias)) {
    return `"${alias.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return alias;
}

/** Tools whose results are rich enough to warrant entity detection */
const PHASE2_TOOLS = new Set([
  "web_fetch",
  "discord_read_channel",
  "remote_execute",
]);

/** Tools that get Phase 1 (deterministic) entity detection only */
const PHASE1_TOOLS = new Set([
  "web_search",
  "shell",
  ...PHASE2_TOOLS,
]);

/** Knowledge-related tools tracked for the session audit */
export const KNOWLEDGE_TOOLS = new Set([
  "save_knowledge",
  "search_vault",
  "analyze_input",
  "add_triage_item",
]);

export interface KnowledgeOperation {
  tool: string;
  args: Record<string, unknown>;
  timestamp: number;
}

/**
 * Build SDK hooks for automatic knowledge retrieval and ingestion.
 */
export function buildSessionHooks(opts: {
  client: CopilotClient;
  vault: VaultManager;
  qmd?: QmdSearch;
  /** Mutable array — hooks push knowledge operations here for session-end audit */
  knowledgeOps: KnowledgeOperation[];
  /** Session logger — if provided, writes knowledge summary on session end */
  logger?: SessionLogger;
  /** Background task manager — if provided, injects completed results on next prompt */
  backgroundTasks?: BackgroundTaskManager;
  /** Session ID used to query completed background tasks */
  sessionId?: string;
}): SessionHooks {
  const { client, vault, qmd, knowledgeOps, logger, backgroundTasks, sessionId } = opts;
  let aliasesModified = false;

  return {
    /**
     * On user prompt: run preprocessor + QMD search, inject relevant context.
     * Also detects knowledge gaps (unmatched entity mentions) and auto-applies aliases.
     */
    onUserPromptSubmitted: async (
      input,
    ) => {
      const prompt = input.prompt;
      if (!prompt || prompt.length < 5) return;

      const sections: string[] = [];

      // Inject completed background task results
      if (backgroundTasks && sessionId) {
        const completed = backgroundTasks.getCompleted(sessionId);
        if (completed.length > 0) {
          sections.push("## Completed Background Tasks");
          for (const run of completed) {
            const label = run.label ?? run.task.slice(0, 80);
            const elapsed = ((run.endedAt ?? Date.now()) - run.startedAt) / 1000;
            if (run.status === "completed") {
              sections.push(
                `### ✅ ${label} (${elapsed.toFixed(0)}s)\n${run.result}`,
              );
            } else {
              sections.push(
                `### ❌ ${label} (failed after ${elapsed.toFixed(0)}s)\nError: ${run.error}`,
              );
            }
          }
          sections.push("\nSummarize these results for the user.\n");
        }
      }

      // Run preprocessor (deterministic + semantic matching)
      let preprocessed: PreprocessorResult | null = null;
      try {
        preprocessed = await runPreprocessor(client, vault, prompt);
      } catch {
        // Preprocessor failed — continue without it
      }

      if (preprocessed) {
        // Auto-apply high-confidence aliases
        for (const { knowledgePath, alias } of preprocessed.newAliases) {
          try {
            const content = await vault.readFile(knowledgePath);
            const aliasMatch = content.match(/^aliases:\s*\[([^\]]*)\]/m);
            if (aliasMatch) {
              const existing = aliasMatch[1];
              const quoted = quoteAlias(alias);
              const newAliases = existing ? `${existing}, ${quoted}` : quoted;
              const updated = content.replace(aliasMatch[0], `aliases: [${newAliases}]`);
              await vault.writeFile(knowledgePath, updated);
              aliasesModified = true;
            }
          } catch {
            // Skip
          }
        }

        // Matched knowledge entries
        if (preprocessed.matched.length > 0) {
          sections.push("## Relevant Knowledge Context");
          for (const entry of preprocessed.matched) {
            sections.push(`### ${entry.path}\n\`\`\`\n${entry.content}\n\`\`\``);
          }
        }

        // Knowledge gaps — entities mentioned but not in KB
        if (preprocessed.newEntities.length > 0) {
          sections.push("\n## Knowledge Gaps Detected");
          sections.push("These entities were mentioned but don't exist in the knowledge base yet. Consider creating entries with `save_knowledge`:");
          for (const entity of preprocessed.newEntities) {
            sections.push(`- **${entity.name}** (${entity.categoryHint}): "${entity.context}"`);
          }
        }

        // Uncertain associations
        if (preprocessed.triageItems.length > 0) {
          sections.push("\n## Uncertain Associations");
          for (const item of preprocessed.triageItems) {
            sections.push(`- "${item.text}" might refer to ${item.suggestedMatch ?? "unknown"} (${item.reasoning})`);
          }
        }
      }

      // QMD search for broader vault context
      if (qmd && (await qmd.isAvailable())) {
        try {
          const results = await qmd.search(prompt, ["knowledge", "notes"], 5);
          if (results.length > 0) {
            // Don't duplicate entries already found by preprocessor
            const alreadyFound = new Set(
              preprocessed?.matched.map((m) => m.path) ?? [],
            );
            const newResults = results.filter((r) => !alreadyFound.has(r.path));
            if (newResults.length > 0) {
              sections.push("\n## Related Vault Notes");
              for (const r of newResults) {
                let line = `- **${r.path}** (relevance: ${r.score.toFixed(2)})`;
                if (r.snippet) line += `: ${r.snippet.slice(0, 200)}`;
                sections.push(line);
              }
            }
          }
        } catch {
          // QMD search failed — continue without it
        }
      }

      if (sections.length === 0) return;

      return {
        additionalContext: sections.join("\n"),
      };
    },

    /**
     * After data-rich tool calls: run entity detection on results,
     * inject structured findings for the agent to act on.
     */
    onPostToolUse: async (
      input,
    ) => {
      const { toolName, toolResult } = input;

      // Track knowledge operations for session audit
      if (KNOWLEDGE_TOOLS.has(toolName)) {
        knowledgeOps.push({
          tool: toolName,
          args: input.toolArgs as Record<string, unknown>,
          timestamp: input.timestamp,
        });
      }

      // Only run entity detection on data-rich tools
      if (!PHASE1_TOOLS.has(toolName)) return;

      const resultText =
        typeof toolResult === "string"
          ? toolResult
          : toolResult?.textResultForLlm ?? "";
      if (!resultText || resultText.length < 50) return;

      // Truncate very long results
      const text = resultText.slice(0, 3000);

      const sections: string[] = [];

      try {
        if (PHASE2_TOOLS.has(toolName)) {
          // Full preprocessor (Phase 1 + Phase 2) for data-rich external tools
          const preprocessed = await runPreprocessor(client, vault, text);

          if (preprocessed.matched.length > 0) {
            sections.push("**Known entities found in result:** " +
              preprocessed.matched.map((m) => `[[${m.path}]]`).join(", "));
          }

          if (preprocessed.newEntities.length > 0) {
            sections.push("**Potential new entities detected:**");
            for (const entity of preprocessed.newEntities) {
              sections.push(`- **${entity.name}** (${entity.categoryHint}): "${entity.context}"`);
            }
            sections.push("Consider saving relevant entities with `save_knowledge`.");
          }

          // Auto-apply aliases
          for (const { knowledgePath, alias } of preprocessed.newAliases) {
            try {
              const content = await vault.readFile(knowledgePath);
              const aliasMatch = content.match(/^aliases:\s*\[([^\]]*)\]/m);
              if (aliasMatch) {
                const existing = aliasMatch[1];
                const quoted = quoteAlias(alias);
                const newAliases = existing ? `${existing}, ${quoted}` : quoted;
                const updated = content.replace(aliasMatch[0], `aliases: [${newAliases}]`);
                await vault.writeFile(knowledgePath, updated);
                aliasesModified = true;
              }
            } catch {
              // Skip
            }
          }
        } else {
          // Phase 1 only (deterministic matching) — free
          const index = await buildKnowledgeIndex(vault);
          if (index.entries.length > 0) {
            const matched = deterministicMatch(index, text);
            if (matched.size > 0) {
              const paths = [...matched].slice(0, 5);
              sections.push("**Known entities referenced in result:** " +
                paths.map((p) => `[[${p}]]`).join(", "));
            }
          }
        }
      } catch {
        // Entity detection failed — don't block
      }

      if (sections.length === 0) return;

      return {
        additionalContext: sections.join("\n"),
      };
    },

    /**
     * On session end: write knowledge changes summary to session log.
     */
    onSessionEnd: async () => {
      // Commit any auto-applied alias changes
      if (aliasesModified) {
        try {
          await vault.commitAndPush("auto-applied knowledge aliases");
        } catch {
          // Don't fail session teardown
        }
      }

      if (logger) {
        try {
          await logger.writeKnowledgeSummary();
        } catch {
          // Don't fail session teardown
        }
      }
    },
  };
}
