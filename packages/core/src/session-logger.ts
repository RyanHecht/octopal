import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";
import type { VaultManager } from "./vault.js";
import { KNOWLEDGE_TOOLS } from "./hooks.js";
import { createLogger } from "./log.js";

const log = createLogger("session-logger");

const MAX_TOOL_RESULT_LENGTH = 2000;
const LOG_DIR = "Resources/Session Logs";

interface ToolCallRecord {
  name: string;
  args?: unknown;
  result?: string;
  partialOutput?: string[];
  success?: boolean;
}

interface KnowledgeLogEntry {
  tool: string;
  summary: string;
}

/**
 * Captures full conversation transcripts and writes them to the vault
 * as browsable markdown files under Resources/Session Logs/.
 */
export class SessionLogger {
  private turnNumber = 0;
  private filePath: string;
  private started: Date;
  private fileCreated = false;

  // Per-turn buffers
  private userMessage = "";
  private assistantMessages: string[] = [];
  private toolCalls: ToolCallRecord[] = [];
  private toolCallMap = new Map<string, ToolCallRecord>();

  // Session-wide knowledge operation tracking
  private knowledgeLog: KnowledgeLogEntry[] = [];

  constructor(
    private vault: VaultManager,
    private sessionId: string,
  ) {
    this.started = new Date();
    const date = this.started.toISOString().slice(0, 10);
    const safeName = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    this.filePath = `${LOG_DIR}/${date}-${safeName}.md`;
  }

  /** Register event listeners on a session. Returns unsubscribe function. */
  attach(session: CopilotSession): () => void {
    const unsubs = [
      session.on("user.message", (event) => {
        this.userMessage = event.data.content;
      }),
      session.on("assistant.message", (event) => {
        if (event.data.content) {
          this.assistantMessages.push(event.data.content);
        }
      }),
      session.on("tool.execution_start", (event) => {
        const record: ToolCallRecord = {
          name: event.data.toolName,
          args: event.data.arguments,
        };
        this.toolCalls.push(record);
        this.toolCallMap.set(event.data.toolCallId, record);
      }),
      session.on("tool.execution_complete", (event) => {
        const record = this.toolCallMap.get(event.data.toolCallId);
        if (record) {
          record.success = event.data.success;
          record.result = event.data.result?.content;
        }
      }),
      session.on("tool.execution_partial_result", (event) => {
        const record = this.toolCallMap.get(event.data.toolCallId);
        if (record) {
          if (!record.partialOutput) record.partialOutput = [];
          record.partialOutput.push(event.data.partialOutput);
        }
      }),
      session.on("assistant.turn_end", () => {
        this.flushTurn().catch((err) => {
          log.error("Failed to flush turn:", err);
        });
      }),
      session.on("session.error", () => {
        this.flushIncomplete().catch((err) => {
          log.error("Failed to flush incomplete turn on error:", err);
        });
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }

  /**
   * Flush any buffered data from an incomplete turn (e.g., on timeout or error).
   * Marks incomplete tool calls with ⏳ so they're visible in the log.
   */
  async flushIncomplete(): Promise<void> {
    if (this.toolCalls.length === 0 && this.assistantMessages.length === 0) return;

    // Mark any tool calls without a completion status
    for (const tc of this.toolCalls) {
      if (tc.success === undefined) {
        tc.success = false;
        if (!tc.result && !tc.partialOutput?.length) {
          tc.result = "(timed out — no response)";
        }
      }
    }

    await this.flushTurn();
  }

  /**
   * Write a "Knowledge Changes" summary section at the end of the session log.
   * Call this on session end.
   */
  async writeKnowledgeSummary(): Promise<void> {
    if (!this.fileCreated || this.knowledgeLog.length === 0) return;

    const lines: string[] = [];
    lines.push("## 🧠 Knowledge Changes");
    lines.push("");
    for (const entry of this.knowledgeLog) {
      lines.push(`- ${entry.summary}`);
    }
    lines.push("");

    await this.vault.appendToFile(this.filePath, lines.join("\n"));
    await this.vault.commitAndPush(
      `session log: ${this.sessionId} knowledge summary`,
    );
  }

  private async ensureFile(): Promise<void> {
    if (this.fileCreated) return;

    const date = this.started.toISOString().slice(0, 10);
    const frontmatter = [
      "---",
      `session_id: "${this.sessionId}"`,
      `started: ${this.started.toISOString()}`,
      "---",
      "",
      `# Session Log — ${date}`,
      "",
    ].join("\n");

    await this.vault.writeFile(this.filePath, frontmatter);
    this.fileCreated = true;
  }

  private async flushTurn(): Promise<void> {
    if (!this.userMessage && this.assistantMessages.length === 0 && this.toolCalls.length === 0) {
      return;
    }

    this.turnNumber++;
    const time = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const lines: string[] = [];
    lines.push(`## Turn ${this.turnNumber} — ${time}`);
    lines.push("");

    if (this.userMessage) {
      lines.push("**User:**");
      lines.push(this.userMessage);
      lines.push("");
    }

    if (this.assistantMessages.length > 0) {
      lines.push("**Assistant:**");
      lines.push(this.assistantMessages.join("\n\n"));
      lines.push("");
    }

    if (this.toolCalls.length > 0) {
      lines.push("### Tool Calls");
      lines.push("");
      for (const tc of this.toolCalls) {
        const argsStr = tc.args ? formatArgs(tc.args) : "";
        const isKnowledge = KNOWLEDGE_TOOLS.has(tc.name);
        const icon = tc.success === false ? "❌" : isKnowledge ? "🧠" : "✅";
        let line = `- ${icon} \`${tc.name}(${argsStr})\``;
        // Prefer streaming partial output for tools like bash; fall back to final result
        const output = tc.partialOutput?.length
          ? tc.partialOutput.join("")
          : tc.result;
        if (output) {
          const truncated = truncate(output, MAX_TOOL_RESULT_LENGTH);
          line += "\n  > " + truncated.replace(/\n/g, "\n  > ");
        }
        lines.push(line);

        // Track knowledge operations for session summary
        if (isKnowledge && tc.success !== false) {
          this.knowledgeLog.push({
            tool: tc.name,
            summary: summarizeKnowledgeOp(tc.name, tc.args, tc.result),
          });
        }
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("");

    await this.ensureFile();
    await this.vault.appendToFile(this.filePath, lines.join("\n"));
    await this.vault.commitAndPush(
      `session log: ${this.sessionId} turn ${this.turnNumber}`,
    );

    // Reset buffers
    this.userMessage = "";
    this.assistantMessages = [];
    this.toolCalls = [];
    this.toolCallMap.clear();
  }
}

function formatArgs(args: unknown): string {
  if (typeof args === "string") return args;
  try {
    const obj = typeof args === "object" && args !== null ? args : {};
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "";
    return entries
      .map(([k, v]) => {
        const val = typeof v === "string" ? `"${v}"` : JSON.stringify(v);
        return `${k}: ${val}`;
      })
      .join(", ");
  } catch {
    return String(args);
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n…(truncated)";
}

/** Generate a one-line summary of a knowledge operation */
function summarizeKnowledgeOp(tool: string, args: unknown, result?: string): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  switch (tool) {
    case "save_knowledge":
      return `Saved ${a.category ?? "entry"}: ${a.name ?? "unknown"}`;
    case "search_vault":
      return `Searched vault: "${a.query ?? ""}" (scope: ${a.scope ?? "all"})`;
    case "analyze_input":
      return `Analyzed input (${typeof a.text === "string" ? a.text.length : 0} chars)`;
    case "add_triage_item":
      return `Triaged: ${a.description ?? "unknown"}`;
    default:
      return `${tool}(${formatArgs(args)})`;
  }
}
