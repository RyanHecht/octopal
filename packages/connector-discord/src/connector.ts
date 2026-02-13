import { Client, GatewayIntentBits, Partials, ChannelType, type Message } from "discord.js";
import type { DiscordConfig } from "@octopal/core";
import { splitMessage } from "./messages.js";

/** Minimal session interface — avoids circular dependency on @octopal/server */
export interface ConnectorSession {
  sendAndWait(message: { prompt: string }, timeoutMs: number): Promise<{ data?: { content?: string } } | undefined>;
}

export interface ConnectorSessionStore {
  getOrCreate(sessionId: string): Promise<ConnectorSession>;
  sendOrRecover(
    sessionId: string,
    prompt: string,
    options?: { timeoutMs?: number },
  ): Promise<{ response: { data?: { content?: string } } | undefined; recovered: boolean }>;
}

/** Generates a short thread title from a user message */
export interface ThreadTitleGenerator {
  generateTitle(messageText: string): Promise<string>;
}

export class DiscordConnector {
  private client: Client;
  private allowedSet: Set<string>;
  private channelSet: Set<string>;

  constructor(
    private config: DiscordConfig,
    private sessionStore: ConnectorSessionStore,
    private titleGenerator?: ThreadTitleGenerator,
  ) {
    this.allowedSet = new Set(config.allowedUsers);
    this.channelSet = new Set(config.channels ?? []);
    this.client = new Client({
      intents: [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });
  }

  /** Expose the Discord client for tools */
  getClient(): Client {
    return this.client;
  }

  /** Get the set of configured channel IDs */
  getChannelIds(): Set<string> {
    return this.channelSet;
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

    // Whitelist check
    if (!this.allowedSet.has(message.author.id)) return;

    const text = message.content.trim();
    if (!text) return;

    const channelType = message.channel.type;

    // DM
    if (channelType === ChannelType.DM) {
      await this.handleDM(message, text);
      return;
    }

    // Thread in a configured channel
    if (
      channelType === ChannelType.PublicThread ||
      channelType === ChannelType.PrivateThread
    ) {
      const parentId = message.channel.parentId;
      if (parentId && this.channelSet.has(parentId)) {
        await this.handleThread(message, text);
      }
      return;
    }

    // Message in a configured channel — auto-create thread
    if (channelType === ChannelType.GuildText && this.channelSet.has(message.channel.id)) {
      await this.handleChannelMessage(message, text);
      return;
    }
  }

  /** Handle a DM message */
  private async handleDM(message: Message, text: string): Promise<void> {
    const sessionId = `discord-dm-${message.author.id}`;
    const channel = message.channel;
    if (!("send" in channel)) return;
    await this.replyInChannel(channel, sessionId, text);
  }

  /** Handle a message in an existing thread */
  private async handleThread(message: Message, text: string): Promise<void> {
    const sessionId = `discord-th-${message.channel.id}`;
    const channel = message.channel;
    if (!("send" in channel)) return;
    await this.replyInChannel(channel, sessionId, text);
  }

  /** Handle a message in a configured channel — auto-create a thread */
  private async handleChannelMessage(message: Message, text: string): Promise<void> {
    const channel = message.channel;

    // Show typing while generating title + waiting for agent
    const typingInterval = setInterval(() => {
      ("sendTyping" in channel) && (channel as any).sendTyping().catch(() => {});
    }, 8_000);
    if ("sendTyping" in channel) await (channel as any).sendTyping().catch(() => {});

    try {
      // Generate a thread title
      let threadName = text.slice(0, 50);
      if (this.titleGenerator) {
        try {
          threadName = await this.titleGenerator.generateTitle(text);
        } catch (err) {
          console.error("[discord] Failed to generate thread title, using fallback:", err);
        }
      }

      // Create thread from the message
      const thread = await message.startThread({
        name: threadName.slice(0, 100), // Discord limit
      });

      // Continue typing in the thread while the agent responds
      clearInterval(typingInterval);
      const threadTypingInterval = setInterval(() => {
        thread.sendTyping().catch(() => {});
      }, 8_000);
      await thread.sendTyping().catch(() => {});

      try {
        const sessionId = `discord-th-${thread.id}`;
        await this.replyInThread(thread, sessionId, text);
      } finally {
        clearInterval(threadTypingInterval);
      }
    } finally {
      clearInterval(typingInterval);
    }
  }

  /** Send a prompt to the agent and reply in a thread (no typing — caller manages it) */
  private async replyInThread(
    channel: { send(content: string): Promise<any> },
    sessionId: string,
    text: string,
  ): Promise<void> {
    try {
      const { response, recovered } = await this.sessionStore.sendOrRecover(sessionId, text);
      const responseText = response?.data?.content ?? "";

      if (recovered) {
        console.log(`[discord] Session ${sessionId} was recovered after expiry`);
        await channel.send("⚡ *Session refreshed — conversation history was reset.*").catch(() => {});
      }

      if (!responseText) return;

      const chunks = splitMessage(responseText);
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[discord] Session ${sessionId} error:`, errMsg);
      await channel.send("Sorry, something went wrong processing your message.").catch(() => {});
    }
  }

  /** Send a prompt to the agent and reply in the given channel */
  private async replyInChannel(
    channel: { send(content: string): Promise<any>; sendTyping?(): Promise<any> },
    sessionId: string,
    text: string,
  ): Promise<void> {
    // Show typing indicator while processing
    const typingInterval = setInterval(() => {
      channel.sendTyping?.().catch(() => {});
    }, 8_000);
    await channel.sendTyping?.().catch(() => {});

    try {
      const { response, recovered } = await this.sessionStore.sendOrRecover(sessionId, text);
      const responseText = response?.data?.content ?? "";

      if (recovered) {
        console.log(`[discord] Session ${sessionId} was recovered after expiry`);
        await channel.send("⚡ *Session refreshed — conversation history was reset.*").catch(() => {});
      }

      if (!responseText) return;

      const chunks = splitMessage(responseText);
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[discord] Session ${sessionId} error:`, errMsg);
      await channel.send("Sorry, something went wrong processing your message.").catch(() => {});
    } finally {
      clearInterval(typingInterval);
    }
  }
}
