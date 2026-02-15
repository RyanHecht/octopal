/**
 * DiscordActivityRenderer — renders SDK SessionEvents as a live-updating
 * Discord embed that shows what the agent is doing during a turn.
 *
 * Embeds persist after the turn ends as an audit trail.
 */

import type { SessionEvent } from "@github/copilot-sdk";
import type { Message } from "discord.js";
import { EmbedBuilder } from "discord.js";

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
}

interface SubagentEntry {
  name: string;
  displayName: string;
  toolCallId: string;
  status: "running" | "done" | "failed";
}

const MAX_FIELD_LENGTH = 1024;
const EDIT_DEBOUNCE_MS = 1500;

/**
 * Renders a live-updating embed showing agent activity.
 * Create one per turn, feed it events, and it manages the embed lifecycle.
 * Embeds persist after the turn ends as an audit trail.
 */
export class DiscordActivityRenderer {
  private intent = "";
  private tools: ToolEntry[] = [];
  private subagents: SubagentEntry[] = [];
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
        this.tools.push({
          name: event.data.toolName,
          toolCallId: event.data.toolCallId,
          status: "running",
        });
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
        this.finished = true;
        await this.flush();
        break;
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

    if (!this.intent && this.tools.length === 0 && this.subagents.length === 0) return;

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
      console.error("[discord-activity] Embed update failed:", err);
    }
  }

  /** Build one or more embeds, splitting if field content exceeds Discord limits */
  private buildEmbeds(): EmbedBuilder[] {
    const lines = this.buildActivityLines();

    if (lines.length === 0) {
      return [this.createEmbed("")];
    }

    const chunks = this.splitIntoChunks(lines, MAX_FIELD_LENGTH);
    return chunks.map((chunk, i) => {
      const embed = this.createEmbed(chunk);
      // Continuation embeds: no title/description, just the overflow field
      if (i > 0) {
        embed.setTitle(null).setDescription(null);
      }
      return embed;
    });
  }

  private createEmbed(fieldContent: string): EmbedBuilder {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
    const embed = new EmbedBuilder()
      .setColor(this.finished ? 0x2ecc71 : 0x3498db)
      .setTitle(this.finished ? "✅ Done" : "🔄 Working…");

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
      lines.push(`${icon} \`${t.name}\``);
    }

    return lines;
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
