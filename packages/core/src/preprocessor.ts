import { CopilotClient } from "@github/copilot-sdk";
import type { VaultManager } from "./vault.js";
import {
  buildKnowledgeIndex,
  deterministicMatch,
  formatIndexForLLM,
  type KnowledgeIndex,
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

const PREPROCESSOR_PROMPT = `You are a knowledge entity matcher. Given a knowledge index and raw input text, your job is to:

1. Identify which known entities from the index are semantically referenced in the input, even if not by exact name.
2. Classify your confidence for each semantic match:
   - HIGH (>85%): You're very confident this reference means this entity. The alias should be auto-added.
   - LOW (<85%): Possible match but uncertain. Flag for human review.
3. Identify NEW entities (people, organizations, terms) mentioned in the input that don't exist in the knowledge base yet.

Consider the entity's aliases, category, and backlink context when matching.

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
  // Build knowledge index
  const index = await buildKnowledgeIndex(vault);

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
    } catch {
      // Skip unreadable
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
        } catch {
          // Skip
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

    newEntities.push(...semanticResult.newEntities);
  } catch {
    // Semantic matching failed — proceed with deterministic results only
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
  index: KnowledgeIndex,
  rawInput: string,
  alreadyMatched: Set<string>,
): Promise<SemanticMatchResult> {
  const indexText = formatIndexForLLM(index);
  const matchedList =
    alreadyMatched.size > 0
      ? `\nAlready matched deterministically (do NOT include these): ${[...alreadyMatched].join(", ")}`
      : "";

  const prompt = `## Knowledge Index\n${indexText}\n${matchedList}\n\n## Raw Input\n${rawInput}`;

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
