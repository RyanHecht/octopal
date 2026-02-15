/**
 * DiscordActivityRenderer — renders SDK SessionEvents as a live-updating
 * Discord embed that shows what the agent is doing during a turn.
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

const MAX_TOOLS_SHOWN = 8;
const EDIT_DEBOUNCE_MS = 1500;

/**
 * Renders a live-updating embed showing agent activity.
 * Create one per turn, feed it events, and it manages the embed lifecycle.
 */
export class DiscordActivityRenderer {
  private intent = "";
  private tools: ToolEntry[] = [];
  private embedMessage: Message | null = null;
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private finished = false;

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

    // Don't create an embed if nothing interesting happened
    if (!this.intent && this.tools.length === 0) return;

    const embed = this.buildEmbed();

    try {
      if (this.embedMessage) {
        await this.embedMessage.edit({ embeds: [embed] });
      } else {
        this.embedMessage = await this.channel.send({ embeds: [embed] });
      }
    } catch (err) {
      // Edit failures are non-fatal (message deleted, permissions, etc.)
      console.error("[discord-activity] Embed update failed:", err);
    }

    // Delete the status embed after the turn completes
    if (this.finished && this.embedMessage) {
      try {
        await this.embedMessage.delete();
      } catch {
        // Best-effort cleanup
      }
      this.embedMessage = null;
    }
  }

  private buildEmbed(): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(this.finished ? 0x2ecc71 : 0x3498db)
      .setTitle(this.finished ? "✅ Done" : "🔄 Working…");

    if (this.intent) {
      embed.setDescription(this.intent);
    }

    if (this.tools.length > 0) {
      const shown = this.tools.slice(-MAX_TOOLS_SHOWN);
      const lines = shown.map((t) => {
        const icon =
          t.status === "running" ? "⏳" : t.status === "done" ? "✅" : "❌";
        return `${icon} \`${t.name}\``;
      });

      if (this.tools.length > MAX_TOOLS_SHOWN) {
        lines.unshift(
          `_…and ${this.tools.length - MAX_TOOLS_SHOWN} more_`,
        );
      }

      embed.addFields({ name: "Tools", value: lines.join("\n") });
    }

    return embed;
  }
}
