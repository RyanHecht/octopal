import { CopilotClient } from "@github/copilot-sdk";
import type { VaultManager } from "./vault.js";
import {
  getCachedAliasLookup,
  deterministicMatch,
  formatEntryRoster,
  type AliasLookup,
} from "./knowledge.js";
import { createLogger } from "./log.js";

const log = createLogger("preprocessor");

export interface PreprocessorResult {
  /** Knowledge entries confirmed relevant to this input */
  matched: { path: string; content: string }[];
  /** New aliases the preprocessor is confident about (auto-applied) */
  newAliases: { knowledgePath: string; alias: string }[];
  /** Low-confidence associations for user review */
  triageItems: {
    text: string;
    suggestedMatch?: string;
    category?: string;
    reasoning: string;
  }[];
  /** New entity candidates not in the knowledge base */
  newEntities: { name: string; categoryHint: string; context: string }[];
}

const PREPROCESSOR_PROMPT = `You are a knowledge entity matcher for a personal knowledge vault. Given a knowledge index and raw input text, your job is to:

1. **Match known entities**: Identify which entities from the index are semantically referenced in the input, even if not by exact name. Consider nicknames, abbreviations, pronouns with clear antecedents, and contextual references (e.g., "my therapist" → a known therapist, "the project" → an active project).
2. **Classify confidence**:
   - HIGH (>85%): Auto-add as alias. Use when the reference clearly and unambiguously maps to exactly one known entity.
   - LOW (<85%): Flag for human review. Use when the reference could plausibly match but you're not certain.
3. **Detect new entities** worth tracking. Create entries for:
   - People the user interacts with or mentions by name (colleagues, contacts, professionals)
   - Organizations they work with, belong to, or reference specifically
   - Systems, tools, or products that come up in their work with domain relevance
   - Terms with domain-specific meaning in the user's context

   Do NOT flag as new entities:
   - Generic concepts everyone knows (email, meeting, calendar, message)
   - Well-known platforms used generically (Google, Slack, GitHub, Discord, YouTube) unless the user has a specific relationship
   - Passing mentions with no relevance to the user's work or interests
   - Single-word common nouns or verbs

Respond with ONLY valid JSON in this exact format (no markdown fences):
{
  "semanticMatches": [
    { "text": "the phrase from input", "knowledgePath": "path/to/entry.md", "confidence": "HIGH or LOW", "reasoning": "why you think this matches" }
  ],
  "newEntities": [
    { "name": "Entity Name", "categoryHint": "People or Terms or Organizations", "context": "surrounding text from input" }
  ]
}

If there are no semantic matches or new entities, return empty arrays.
Do NOT include entities that were already matched deterministically (those are listed separately).
`;

/** Common generic terms that should NOT be flagged as new entities */
const ENTITY_STOPLIST = new Set([
  // Generic concepts
  "email", "meeting", "call", "message", "chat", "thread", "note", "task",
  "project", "area", "resource", "inbox", "calendar", "schedule", "event",
  "document", "file", "folder", "page", "link", "url", "api", "server",
  // Well-known platforms (generic usage)
  "google", "slack", "github", "discord", "youtube", "twitter", "reddit",
  "linkedin", "zoom", "teams", "notion", "obsidian", "vscode", "chrome",
  "firefox", "safari", "windows", "macos", "linux", "android", "ios",
  // Common actions/concepts
  "deploy", "build", "test", "release", "update", "install", "config",
  "setup", "login", "logout", "password", "token", "key", "database",
]);

/**
 * Run the two-phase preprocessor:
 * Phase 1: Deterministic string matching (no LLM)
 * Phase 2: Semantic matching via Haiku (single LLM call)
 */
export async function runPreprocessor(
  client: CopilotClient,
  vault: VaultManager,
  rawInput: string,
): Promise<PreprocessorResult> {
  // Build lightweight alias lookup (cached, no vault walk)
  const index = await getCachedAliasLookup(vault);

  if (index.entries.length === 0) {
    return { matched: [], newAliases: [], triageItems: [], newEntities: [] };
  }

  // Phase 1: Deterministic matching
  const deterministicPaths = deterministicMatch(index, rawInput);

  // Load deterministically matched entries
  const matched: { path: string; content: string }[] = [];
  for (const p of deterministicPaths) {
    try {
      const content = await vault.readFile(p);
      matched.push({ path: p, content });
    } catch (e) {
      log.warn("Failed to read deterministic match", e);
    }
  }

  // Phase 2: Semantic matching via Haiku
  const newAliases: PreprocessorResult["newAliases"] = [];
  const triageItems: PreprocessorResult["triageItems"] = [];
  const newEntities: PreprocessorResult["newEntities"] = [];

  // Only run Phase 2 if there are knowledge entries to match against
  try {
    const doneSemantic = log.timed("Semantic match");
    const semanticResult = await runSemanticMatch(
      client,
      vault,
      index,
      rawInput,
      deterministicPaths,
    );
    doneSemantic();

    // Process semantic matches
    for (const match of semanticResult.semanticMatches) {
      // Add to matched if not already there
      if (!deterministicPaths.has(match.knowledgePath)) {
        try {
          const content = await vault.readFile(match.knowledgePath);
          matched.push({ path: match.knowledgePath, content });
        } catch (e) {
          log.warn("Failed to read semantic match", e);
        }
      }

      if (match.confidence === "HIGH") {
        newAliases.push({
          knowledgePath: match.knowledgePath,
          alias: match.text,
        });
      } else {
        triageItems.push({
          text: match.text,
          suggestedMatch: match.knowledgePath,
          reasoning: match.reasoning,
        });
      }
    }

    // Filter new entities through stoplist
    const filtered = semanticResult.newEntities.filter(
      (e) => !ENTITY_STOPLIST.has(e.name.toLowerCase()),
    );
    newEntities.push(...filtered);
  } catch (e) {
    log.warn("Semantic matching failed — proceeding with deterministic results only", e);
  }

  return { matched, newAliases, triageItems, newEntities };
}

interface SemanticMatchResult {
  semanticMatches: {
    text: string;
    knowledgePath: string;
    confidence: "HIGH" | "LOW";
    reasoning: string;
  }[];
  newEntities: {
    name: string;
    categoryHint: string;
    context: string;
  }[];
}

async function runSemanticMatch(
  client: CopilotClient,
  vault: VaultManager,
  index: AliasLookup,
  rawInput: string,
  alreadyMatched: Set<string>,
): Promise<SemanticMatchResult> {
  const indexText = formatEntryRoster(index);
  const matchedList =
    alreadyMatched.size > 0
      ? `\nAlready matched deterministically (do NOT include these): ${[...alreadyMatched].join(", ")}`
      : "";

  // Inject active project and area names for relevance context
  let userContext = "";
  try {
    const projects = await vault.listDir("Projects");
    const areas = await vault.listDir("Areas");
    const projectNames = projects.filter((d) => d.endsWith("/")).map((d) => d.slice(0, -1));
    const areaNames = areas.filter((d) => d.endsWith("/")).map((d) => d.slice(0, -1));
    if (projectNames.length > 0 || areaNames.length > 0) {
      const parts: string[] = [];
      if (projectNames.length > 0) parts.push(`Projects: ${projectNames.join(", ")}`);
      if (areaNames.length > 0) parts.push(`Areas: ${areaNames.join(", ")}`);
      userContext = `\n\n## User Context\nThe user is currently working on: ${parts.join("; ")}. Entities relevant to these are more likely worth tracking.`;
    }
  } catch (e) {
    log.warn("Failed to list projects/areas for preprocessor context", e);
  }

  const prompt = `## Knowledge Index\n${indexText}\n${matchedList}${userContext}\n\n## Raw Input\n${rawInput}`;

  const session = await client.createSession({
    model: "claude-haiku-4.5",
    systemMessage: {
      mode: "replace",
      content: PREPROCESSOR_PROMPT,
    },
  });

  try {
    const response = await session.sendAndWait({ prompt }, 30_000);
    const responseText = response?.data?.content ?? "";

    // Parse JSON response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { semanticMatches: [], newEntities: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]) as SemanticMatchResult;
    return {
      semanticMatches: parsed.semanticMatches || [],
      newEntities: parsed.newEntities || [],
    };
  } finally {
    await session.destroy();
  }
}
