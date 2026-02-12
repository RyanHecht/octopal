import { Client, GatewayIntentBits, Partials, ChannelType, type Message } from "discord.js";
import type { DiscordConfig } from "@octopal/core";
import { splitMessage } from "./messages.js";

/** Minimal session interface — avoids circular dependency on @octopal/server */
export interface ConnectorSession {
  sendAndWait(message: { prompt: string }, timeoutMs: number): Promise<{ data?: { content?: string } } | undefined>;
}

export interface ConnectorSessionStore {
  getOrCreate(sessionId: string): Promise<ConnectorSession>;
}

export class DiscordConnector {
  private client: Client;
  private allowedSet: Set<string>;

  constructor(
    private config: DiscordConfig,
    private sessionStore: ConnectorSessionStore,
  ) {
    this.allowedSet = new Set(config.allowedUsers);
    this.client = new Client({
      intents: [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
  }

  async start(): Promise<void> {
    this.client.on("ready", () => {
      console.log(`[discord] Logged in as ${this.client.user?.tag}`);
    });

    this.client.on("messageCreate", (message) => {
      this.handleMessage(message).catch((err) => {
        console.error("[discord] Error handling message:", err);
      });
    });

    await this.client.login(this.config.botToken);
  }

  async stop(): Promise<void> {
    this.client.removeAllListeners();
    await this.client.destroy();
    console.log("[discord] Disconnected");
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ignore bots
    if (message.author.bot) return;

    // DMs only
    if (message.channel.type !== ChannelType.DM) return;

    // Whitelist check
    if (!this.allowedSet.has(message.author.id)) {
      return;
    }

    const text = message.content.trim();
    if (!text) return;

    const sessionId = `discord-${message.author.id}`;
    const channel = message.channel;

    if (!("sendTyping" in channel)) return;

    // Show typing indicator while processing
    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 8_000);
    await channel.sendTyping().catch(() => {});

    try {
      const session = await this.sessionStore.getOrCreate(sessionId);
      const response = await session.sendAndWait({ prompt: text }, 300_000);
      const responseText = response?.data?.content ?? "";

      if (!responseText) return;

      const chunks = splitMessage(responseText);
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[discord] Session ${sessionId} error:`, errMsg);
      if ("send" in message.channel) {
        await message.channel.send("Sorry, something went wrong processing your message.").catch(() => {});
      }
    } finally {
      clearInterval(typingInterval);
    }
  }
}
