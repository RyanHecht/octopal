/**
 * Transcript accumulator for voice sessions.
 *
 * Logs timestamped user/assistant turns during a voice call.
 * On session end, formats the transcript as markdown for vault storage.
 */

import type { TranscriptEntry } from "./types.js";

export class TranscriptAccumulator {
  private readonly entries: TranscriptEntry[] = [];
  private readonly startTime = new Date();

  addEntry(role: "user" | "assistant", text: string): void {
    this.entries.push({ role, text, timestamp: new Date() });
  }

  getEntries(): readonly TranscriptEntry[] {
    return this.entries;
  }

  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** Format the transcript as markdown suitable for vault storage */
  toMarkdown(): string {
    const dateStr = this.startTime.toISOString().split("T")[0];
    const timeStr = this.startTime.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const lines: string[] = [
      `# Voice Call — ${dateStr} ${timeStr}`,
      "",
      `**Started:** ${this.startTime.toISOString()}`,
      `**Duration:** ${this.formatDuration()}`,
      `**Turns:** ${this.entries.length}`,
      "",
      "---",
      "",
    ];

    for (const entry of this.entries) {
      const ts = entry.timestamp.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const speaker = entry.role === "user" ? "🗣️ User" : "🤖 Octopal";
      lines.push(`**${speaker}** (${ts}):`);
      lines.push(entry.text);
      lines.push("");
    }

    return lines.join("\n");
  }

  private formatDuration(): string {
    const endTime =
      this.entries.length > 0
        ? this.entries[this.entries.length - 1].timestamp
        : this.startTime;
    const durationMs = endTime.getTime() - this.startTime.getTime();
    const minutes = Math.floor(durationMs / 60_000);
    const seconds = Math.floor((durationMs % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}
