import type { CopilotClient, SessionConfig, ToolResultObject } from "@github/copilot-sdk";
import type { VaultManager } from "./vault.js";
import type { QmdSearch } from "./qmd.js";
import type { SessionLogger } from "./session-logger.js";
import type { BackgroundTaskManager } from "./background-tasks.js";
import type { TurnSourceCollector } from "./sources.js";
import { runPreprocessor, type PreprocessorResult } from "./preprocessor.js";
import { deterministicMatch, getCachedAliasLookup, addAliasToEntry } from "./knowledge.js";
import { createLogger } from "./log.js";

const log = createLogger("hooks");

/** Extract the SessionHooks type from SessionConfig */
type SessionHooks = NonNullable<SessionConfig["hooks"]>;

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
  /** Source collector — if provided, emits sources for each matched entry */
  sourceCollector?: TurnSourceCollector;
}): SessionHooks {
  const { client, vault, qmd, knowledgeOps, logger, backgroundTasks, sessionId, sourceCollector } = opts;
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

      const doneHook = log.timed("onUserPromptSubmitted");
      const sections: string[] = [];

      // Clear sources from previous turn
      sourceCollector?.clear();

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
        const donePreprocess = log.timed("preprocessor");
        preprocessed = await runPreprocessor(client, vault, prompt);
        donePreprocess();
      } catch (e) {
        log.warn("Preprocessor failed — continuing without it", e);
      }

      if (preprocessed) {
        // Auto-apply high-confidence aliases
        for (const { knowledgePath, alias } of preprocessed.newAliases) {
          if (await addAliasToEntry(vault, knowledgePath, alias)) {
            aliasesModified = true;
          }
        }

        // Matched knowledge entries
        if (preprocessed.matched.length > 0) {
          sections.push("## Relevant Knowledge Context");
          for (const entry of preprocessed.matched) {
            sections.push(`### ${entry.path}\n\`\`\`\n${entry.content}\n\`\`\``);
            sourceCollector?.add({
              type: "knowledge-match",
              title: entry.path.replace(/^Resources\/Knowledge\//, "").replace(/\.md$/, ""),
              path: entry.path,
            });
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
          const doneQmd = log.timed("QMD search");
          const results = await qmd.search(prompt, ["knowledge", "notes"], 5);
          doneQmd();
          if (results.length > 0) {
            // Don't duplicate entries already found by preprocessor
            const alreadyFound = new Set(
              preprocessed?.matched.map((m) => m.path) ?? [],
            );
            const newResults = results.filter((r) => !alreadyFound.has(r.path));
            if (newResults.length > 0) {
              // Split: knowledge entries get full content, others get snippets
              const knowledgeResults = newResults.filter((r) => r.path.startsWith("Resources/Knowledge/"));
              const noteResults = newResults.filter((r) => !r.path.startsWith("Resources/Knowledge/"));

              // Load full content for knowledge entries found via QMD
              if (knowledgeResults.length > 0) {
                // Add to Relevant Knowledge Context (or create section if preprocessor didn't find any)
                const hasKnowledgeSection = preprocessed?.matched && preprocessed.matched.length > 0;
                if (!hasKnowledgeSection) {
                  sections.push("## Relevant Knowledge Context");
                }
                for (const r of knowledgeResults) {
                  try {
                    const content = await vault.readFile(r.path);
                    sections.push(`### ${r.path}\n\`\`\`\n${content}\n\`\`\``);
                    sourceCollector?.add({
                      type: "knowledge-match",
                      title: r.path.replace(/^Resources\/Knowledge\//, "").replace(/\.md$/, ""),
                      path: r.path,
                    });
                  } catch (e) {
                    log.warn(`Failed to read QMD knowledge match ${r.path}`, e);
                  }
                }
              }

              if (noteResults.length > 0) {
                sections.push("\n## Related Vault Notes");
                for (const r of noteResults) {
                  let line = `- **${r.path}** (relevance: ${r.score.toFixed(2)})`;
                  if (r.snippet) line += `: ${r.snippet.slice(0, 200)}`;
                  sections.push(line);
                  sourceCollector?.add({
                    type: "vault-search",
                    title: r.title ?? r.path.replace(/\.md$/, ""),
                    path: r.path,
                    snippet: r.snippet,
                    confidence: r.score,
                  });
                }
              }
            }
          }
        } catch (e) {
          log.warn("QMD search failed — continuing without it", e);
        }
      }

      if (sections.length === 0) {
        doneHook();
        return;
      }

      doneHook();
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

      const donePostTool = log.timed(`onPostToolUse (${toolName})`);

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
            for (const m of preprocessed.matched) {
              sourceCollector?.add({
                type: "entity-detection",
                title: m.path.replace(/^Resources\/Knowledge\//, "").replace(/\.md$/, ""),
                path: m.path,
                metadata: { toolName },
              });
            }
          }

          if (preprocessed.newEntities.length > 0) {
            sections.push("**Potential new entities detected:**");
            for (const entity of preprocessed.newEntities) {
              sections.push(`- **${entity.name}** (${entity.categoryHint}): "${entity.context}"`);
            }
            sections.push("Save any newly referenced people, organizations, or systems relevant to the user's work using `save_knowledge`. Search first to avoid duplicates.");
          }

          // Auto-apply aliases
          for (const { knowledgePath, alias } of preprocessed.newAliases) {
            if (await addAliasToEntry(vault, knowledgePath, alias)) {
              aliasesModified = true;
            }
          }
        } else {
          // Phase 1 only (deterministic matching) — free
          const index = await getCachedAliasLookup(vault);
          if (index.entries.length > 0) {
            const matched = deterministicMatch(index, text);
            if (matched.size > 0) {
              const paths = [...matched].slice(0, 5);
              sections.push("**Known entities referenced in result:** " +
                paths.map((p) => `[[${p}]]`).join(", "));
              for (const p of paths) {
                sourceCollector?.add({
                  type: "entity-detection",
                  title: p.replace(/^Resources\/Knowledge\//, "").replace(/\.md$/, ""),
                  path: p,
                  metadata: { toolName },
                });
              }
            }
          }
        }
      } catch (e) {
        log.warn(`Entity detection failed for ${toolName} — continuing`, e);
      }

      if (sections.length === 0) {
        donePostTool();
        return;
      }

      donePostTool();
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
        } catch (e) {
          log.warn("Failed to commit alias changes", e);
        }
      }

      if (logger) {
        try {
          await logger.writeKnowledgeSummary();
        } catch (e) {
          log.warn("Failed to write knowledge summary", e);
        }
      }
    },
  };
}
