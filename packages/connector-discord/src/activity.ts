/**
 * DiscordActivityRenderer — renders SDK SessionEvents as a live-updating
 * Discord embed that shows what the agent is doing during a turn.
 *
 * Embeds persist after the turn ends as an audit trail.
 */

import type { SessionEvent } from "@github/copilot-sdk";
import type { Message } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { createLogger, type Source } from "@octopal/core";

const log = createLogger("discord-activity");

/** A Discord-like channel that can send messages */
export interface ActivityChannel {
  send(options: {
    embeds: EmbedBuilder[];
  }): Promise<Message>;
}

interface ToolEntry {
  name: string;
  toolCallId: string;
  status: "running" | "done" | "failed";
  args?: string;
}

interface SubagentEntry {
  name: string;
  displayName: string;
  toolCallId: string;
  status: "running" | "done" | "failed";
}

const MAX_FIELD_LENGTH = 1024;
const EDIT_DEBOUNCE_MS = 1500;
const MAX_ARG_VALUE_LENGTH = 80;

/** Format tool arguments as a compact summary string for display */
function formatToolArgs(args: unknown): string {
  if (args == null) return "";
  if (typeof args !== "object") return String(args);

  const obj = args as Record<string, unknown>;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue;
    let display: string;
    if (typeof value === "string") {
      display = value.length > MAX_ARG_VALUE_LENGTH
        ? value.slice(0, MAX_ARG_VALUE_LENGTH) + "…"
        : value;
    } else if (typeof value === "object") {
      display = JSON.stringify(value);
      if (display.length > MAX_ARG_VALUE_LENGTH) {
        display = display.slice(0, MAX_ARG_VALUE_LENGTH) + "…";
      }
    } else {
      display = String(value);
    }
    parts.push(`${key}: ${display}`);
  }
  return parts.join(", ");
}

/**
 * Renders a live-updating embed showing agent activity.
 * Create one per turn, feed it events, and it manages the embed lifecycle.
 * Embeds persist after the turn ends as an audit trail.
 */
export class DiscordActivityRenderer {
  private intent = "";
  private tools: ToolEntry[] = [];
  private subagents: SubagentEntry[] = [];
  private sources: Source[] = [];
  private embedMessage: Message | null = null;
  private continuationMessages: Message[] = [];
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private finished = false;
  private startTime = Date.now();

  constructor(private channel: ActivityChannel) {}

  /** Feed a SessionEvent; renderer decides what to display */
  async onEvent(event: SessionEvent): Promise<void> {
    switch (event.type) {
      case "assistant.intent":
        this.intent = event.data.intent;
        this.scheduleUpdate();
        break;

      case "tool.execution_start":
        // report_intent calls update the embed header instead of showing as a tool
        if (event.data.toolName === "report_intent") {
          const args = event.data.arguments as Record<string, unknown> | undefined;
          if (args?.intent && typeof args.intent === "string") {
            this.intent = args.intent;
          }
        } else {
          this.tools.push({
            name: event.data.toolName,
            toolCallId: event.data.toolCallId,
            status: "running",
            args: formatToolArgs(event.data.arguments),
          });
        }
        this.scheduleUpdate();
        break;

      case "tool.execution_complete": {
        const tool = this.tools.find(
          (t) => t.toolCallId === event.data.toolCallId,
        );
        if (tool) {
          tool.status = event.data.success ? "done" : "failed";
          this.scheduleUpdate();
        }
        break;
      }

      case "subagent.started":
        this.subagents.push({
          name: event.data.agentName,
          displayName: event.data.agentDisplayName,
          toolCallId: event.data.toolCallId,
          status: "running",
        });
        this.scheduleUpdate();
        break;

      case "subagent.completed": {
        const agent = this.subagents.find(
          (a) => a.toolCallId === event.data.toolCallId,
        );
        if (agent) {
          agent.status = "done";
          this.scheduleUpdate();
        }
        break;
      }

      case "subagent.failed": {
        const agent = this.subagents.find(
          (a) => a.toolCallId === event.data.toolCallId,
        );
        if (agent) {
          agent.status = "failed";
          this.scheduleUpdate();
        }
        break;
      }

      case "assistant.turn_end":
        // Don't set finished here — multi-turn interactions have multiple
        // turn_end events. The connector calls flush() or finishWithError()
        // when the full interaction completes.
        await this.flush();
        break;
    }
  }

  /** Add a source that informed this turn */
  addSource(source: Source): void {
    // Deduplicate by path (or title if no path)
    const key = source.path ?? source.title;
    if (!this.sources.some((s) => (s.path ?? s.title) === key)) {
      this.sources.push(source);
      this.scheduleUpdate();
    }
  }

  /** Flush pending updates immediately (call on turn end) */
  async flush(): Promise<void> {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }
    await this.updateEmbed();
  }

  /** Mark the turn as successfully completed and flush */
  async finishSuccess(): Promise<void> {
    this.finished = true;
    await this.flush();
  }

  /** Mark the turn as failed and flush (call on timeout/error) */
  async finishWithError(errorMessage?: string): Promise<void> {
    // Mark any still-running tools as failed
    for (const t of this.tools) {
      if (t.status === "running") t.status = "failed";
    }
    for (const a of this.subagents) {
      if (a.status === "running") a.status = "failed";
    }
    this.finished = true;
    if (errorMessage) this.intent = errorMessage;
    await this.flush();
  }

  private scheduleUpdate(): void {
    this.dirty = true;
    if (this.editTimer) return;
    this.editTimer = setTimeout(async () => {
      this.editTimer = null;
      await this.updateEmbed();
    }, EDIT_DEBOUNCE_MS);
  }

  private async updateEmbed(): Promise<void> {
    if (!this.dirty && this.embedMessage) return;
    this.dirty = false;

    if (!this.intent && this.tools.length === 0 && this.subagents.length === 0 && this.sources.length === 0) return;

    const embeds = this.buildEmbeds();

    try {
      if (this.embedMessage) {
        await this.embedMessage.edit({ embeds: [embeds[0]] });
        // Handle continuation embeds for overflow
        for (let i = 1; i < embeds.length; i++) {
          if (i - 1 < this.continuationMessages.length) {
            await this.continuationMessages[i - 1].edit({ embeds: [embeds[i]] });
          } else {
            const msg = await this.channel.send({ embeds: [embeds[i]] });
            this.continuationMessages.push(msg);
          }
        }
      } else {
        this.embedMessage = await this.channel.send({ embeds: [embeds[0]] });
        for (let i = 1; i < embeds.length; i++) {
          const msg = await this.channel.send({ embeds: [embeds[i]] });
          this.continuationMessages.push(msg);
        }
      }
    } catch (err) {
      log.error("Embed update failed:", err);
    }
  }

  /** Build one or more embeds, splitting if field content exceeds Discord limits */
  private buildEmbeds(): EmbedBuilder[] {
    const lines = this.buildActivityLines();

    if (lines.length === 0 && this.sources.length === 0) {
      return [this.createEmbed("")];
    }

    // Build activity embeds first
    const chunks = lines.length > 0
      ? this.splitIntoChunks(lines, MAX_FIELD_LENGTH)
      : [];

    const embeds = chunks.map((chunk, i) => {
      const embed = this.createEmbed(chunk);
      if (i > 0) {
        embed.setTitle(null).setDescription(null);
      }
      return embed;
    });

    // If no activity embeds yet, create the base embed
    if (embeds.length === 0) {
      embeds.push(this.createEmbed(""));
    }

    // Append sources field — try on the last embed, overflow into new embed
    if (this.sources.length > 0) {
      const sourcesText = this.buildSourcesText();
      const lastEmbed = embeds[embeds.length - 1];
      const existingFields = lastEmbed.data.fields?.length ?? 0;

      // Discord allows up to 25 fields per embed; check if we can add one
      if (existingFields < 25 && sourcesText.length <= MAX_FIELD_LENGTH) {
        lastEmbed.addFields({ name: "📚 Context", value: sourcesText });
      } else {
        // Overflow into a new continuation embed
        const sourceEmbed = new EmbedBuilder()
          .setColor(lastEmbed.data.color ?? 0x3498db)
          .addFields({ name: "📚 Context", value: sourcesText.slice(0, MAX_FIELD_LENGTH) });
        embeds.push(sourceEmbed);
      }
    }

    return embeds;
  }

  private createEmbed(fieldContent: string): EmbedBuilder {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
    const hasErrors = this.tools.some((t) => t.status === "failed")
      || this.subagents.some((a) => a.status === "failed");
    const embed = new EmbedBuilder()
      .setColor(hasErrors ? 0xe74c3c : this.finished ? 0x2ecc71 : 0x3498db)
      .setTitle(hasErrors ? "❌ Error" : this.finished ? "✅ Done" : "🔄 Working…");

    if (this.intent) {
      embed.setDescription(this.intent);
    }

    if (fieldContent) {
      embed.addFields({ name: "Activity", value: fieldContent });
    }

    if (this.finished) {
      embed.setFooter({ text: `Completed in ${elapsed}s` });
    }

    return embed;
  }

  private buildActivityLines(): string[] {
    const lines: string[] = [];

    for (const a of this.subagents) {
      const icon = a.status === "running" ? "⏳" : a.status === "done" ? "✅" : "❌";
      lines.push(`${icon} 🤖 \`${a.displayName}\``);
    }

    for (const t of this.tools) {
      const icon = t.status === "running" ? "⏳" : t.status === "done" ? "✅" : "❌";
      const args = t.args ? `(${t.args})` : "";
      lines.push(`${icon} \`${t.name}${args}\``);
    }

    return lines;
  }

  /** Build compact text for the sources field */
  private buildSourcesText(): string {
    const icons: Record<string, string> = {
      "knowledge-match": "📖",
      "vault-search": "🔍",
      "entity-detection": "🏷️",
    };

    const lines: string[] = [];
    for (const s of this.sources) {
      const icon = icons[s.type] ?? "📄";
      let line = `${icon} ${s.title}`;
      if (s.confidence != null) {
        line += ` (${s.confidence.toFixed(2)})`;
      }
      lines.push(line);
    }

    if (lines.join("\n").length > MAX_FIELD_LENGTH) {
      // Truncate and show count
      const truncated: string[] = [];
      let len = 0;
      for (const line of lines) {
        if (len + line.length + 1 > MAX_FIELD_LENGTH - 30) {
          truncated.push(`…and ${lines.length - truncated.length} more`);
          break;
        }
        truncated.push(line);
        len += line.length + 1;
      }
      return truncated.join("\n");
    }

    return lines.join("\n");
  }

  /** Split lines into chunks where each chunk's joined text fits within maxLen */
  private splitIntoChunks(lines: string[], maxLen: number): string[] {
    const chunks: string[] = [];
    let current: string[] = [];
    let currentLen = 0;

    for (const line of lines) {
      const addedLen = current.length > 0 ? line.length + 1 : line.length;
      if (currentLen + addedLen > maxLen && current.length > 0) {
        chunks.push(current.join("\n"));
        current = [line];
        currentLen = line.length;
      } else {
        current.push(line);
        currentLen += addedLen;
      }
    }

    if (current.length > 0) {
      chunks.push(current.join("\n"));
    }

    return chunks;
  }
}
