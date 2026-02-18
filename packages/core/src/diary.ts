import type { CopilotClient } from "@github/copilot-sdk";
import type { VaultManager } from "./vault.js";
import type { KnowledgeOperation } from "./hooks.js";
import { createLogger } from "./log.js";

const log = createLogger("diary");

const DIARY_DIR = "Meta/diary";
const MAX_INJECT_BYTES = 4096;

const DIARY_SUMMARY_PROMPT = `You are summarizing a session for a personal assistant's diary. Given the session data below, produce 5-10 concise bullet points covering:

1. **Actions with side effects**: vault writes, knowledge entries created/updated, commits, deployments, file changes
2. **Things learned about the user**: preferences, corrections, new context, decisions
3. **Key outcomes**: what was accomplished, what was decided
4. **Open threads**: things left unfinished, questions to follow up on, ideas to revisit

Rules:
- Be specific — include names, paths, and details (not "updated a note" but "updated [[Dr. Chen]] with new phone number")
- Skip routine operations (reading files, searching) — only note meaningful actions
- If nothing significant happened, say "Light session — no notable actions"
- Output ONLY the bullet points, no preamble or headers
`;

const OBSERVATION_PROMPT = `You are a personal assistant reflecting on a session with your user. Based on the session data below, identify any NEW observations about:

1. **Communication style**: How the user prefers to receive information (concise vs detailed, structured vs freeform)
2. **Work patterns**: When they work, how they organize, what they prioritize
3. **Interaction patterns**: How they phrase requests, what frustrates them, what delights them
4. **Behavioral corrections**: Anything the user explicitly or implicitly corrected ("I wish you would...", "don't do X", rephrasing your output)

Rules:
- Only note genuinely NEW observations — things that aren't obvious from a single message
- Be specific and actionable (not "user likes structure" but "user prefers tasks with start dates, not just due dates")
- If you detect correction language, quote the user's words
- If nothing new was observed, respond with exactly: "NO_NEW_OBSERVATIONS"
- Output each observation as a bullet point, no preamble or headers
`;

/**
 * Write a diary entry summarizing the session.
 * Called from onSessionEnd hook.
 */
export async function writeDiaryEntry(
  client: CopilotClient,
  vault: VaultManager,
  sessionData: {
    knowledgeOps: KnowledgeOperation[];
    toolSummaries: string[];
    sessionId?: string;
  },
): Promise<void> {
  const { knowledgeOps, toolSummaries, sessionId } = sessionData;

  // Don't write diary for trivial sessions
  if (toolSummaries.length === 0 && knowledgeOps.length === 0) {
    log.debug("Skipping diary — trivial session");
    return;
  }

  const contextParts: string[] = [];
  if (sessionId) contextParts.push(`Session ID: ${sessionId}`);
  if (knowledgeOps.length > 0) {
    contextParts.push("## Knowledge Operations");
    for (const op of knowledgeOps) {
      const args = Object.entries(op.args)
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(", ");
      contextParts.push(`- ${op.tool}(${args})`);
    }
  }
  if (toolSummaries.length > 0) {
    contextParts.push("## Tool Calls Summary");
    contextParts.push(toolSummaries.join("\n"));
  }

  const doneDiary = log.timed("diary entry");

  try {
    const session = await client.createSession({
      model: "claude-haiku-4.5",
      systemMessage: { mode: "replace", content: DIARY_SUMMARY_PROMPT },
    });
    try {
      const response = await session.sendAndWait(
        { prompt: contextParts.join("\n") },
        30_000,
      );
      const summary = response?.data?.content?.trim();
      if (!summary) {
        doneDiary();
        return;
      }

      const now = new Date();
      const monthFile = `${DIARY_DIR}/${now.toISOString().slice(0, 7)}.md`;
      const dateStr = now.toISOString().slice(0, 10);
      const timeStr = now.toISOString().slice(11, 16);

      // Ensure monthly file exists
      let existing = "";
      try {
        existing = await vault.readFile(monthFile);
      } catch {
        existing = `# Agent Diary — ${now.toISOString().slice(0, 7)}\n\n`;
        await vault.writeFile(monthFile, existing);
      }

      const entry = `## ${dateStr} ${timeStr}${sessionId ? ` (${sessionId})` : ""}\n${summary}\n\n`;
      await vault.appendToFile(monthFile, entry);
      doneDiary();
    } finally {
      await session.destroy();
    }
  } catch (e) {
    doneDiary();
    log.warn("Failed to write diary entry", e);
  }
}

/**
 * Generate agent observations about the user from this session.
 * Returns the observation text, or null if nothing new was observed.
 */
export async function generateObservations(
  client: CopilotClient,
  vault: VaultManager,
  sessionData: {
    knowledgeOps: KnowledgeOperation[];
    toolSummaries: string[];
  },
): Promise<void> {
  const { knowledgeOps, toolSummaries } = sessionData;

  if (toolSummaries.length === 0 && knowledgeOps.length === 0) {
    return;
  }

  const doneObs = log.timed("observations");

  try {
    const contextParts: string[] = [];
    if (knowledgeOps.length > 0) {
      contextParts.push("## Knowledge Operations");
      for (const op of knowledgeOps) {
        const args = Object.entries(op.args)
          .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join(", ");
        contextParts.push(`- ${op.tool}(${args})`);
      }
    }
    if (toolSummaries.length > 0) {
      contextParts.push("## Tool Calls Summary");
      contextParts.push(toolSummaries.join("\n"));
    }

    const session = await client.createSession({
      model: "claude-haiku-4.5",
      systemMessage: { mode: "replace", content: OBSERVATION_PROMPT },
    });
    try {
      const response = await session.sendAndWait(
        { prompt: contextParts.join("\n") },
        30_000,
      );
      const text = response?.data?.content?.trim();
      if (!text || text === "NO_NEW_OBSERVATIONS") {
        doneObs();
        return;
      }

      const obsPath = "Meta/observations.md";
      const dateStr = new Date().toISOString().slice(0, 10);
      const entry = `\n### ${dateStr}\n${text}\n`;

      try {
        await vault.readFile(obsPath);
      } catch {
        // File doesn't exist — create it
        await vault.writeFile(obsPath, "# Agent Observations\n");
      }

      await vault.appendToFile(obsPath, entry);
      doneObs();
    } finally {
      await session.destroy();
    }
  } catch (e) {
    doneObs();
    log.warn("Failed to generate observations", e);
  }
}

/**
 * Read recent diary entries for injection at session start.
 * Returns formatted diary text, capped at MAX_INJECT_BYTES.
 */
export async function getRecentDiary(vault: VaultManager): Promise<string> {
  try {
    const files = await vault.listDir(DIARY_DIR);
    const mdFiles = files.filter((f) => f.endsWith(".md")).sort().reverse();

    if (mdFiles.length === 0) return "";

    let combined = "";
    for (const file of mdFiles.slice(0, 3)) {
      try {
        const content = await vault.readFile(`${DIARY_DIR}/${file}`);
        // Extract entries (## headers with their bullets), skip the file title
        const entries = content.split(/^## /m).slice(1); // skip title
        // Entries are chronological in file; reverse to get newest first
        for (const entry of entries.reverse()) {
          const formatted = `## ${entry}`;
          if (combined.length + formatted.length > MAX_INJECT_BYTES) {
            return combined || formatted.slice(0, MAX_INJECT_BYTES);
          }
          combined += formatted;
        }
      } catch (e) {
        log.warn(`Failed to read diary file ${file}`, e);
      }
    }

    return combined;
  } catch {
    return "";
  }
}
