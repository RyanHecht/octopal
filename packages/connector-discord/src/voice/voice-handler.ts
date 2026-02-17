/**
 * Discord voice handler.
 *
 * Monitors voice state updates and auto-joins voice channels when
 * an allowed user connects. Creates a VoicePipeline for the session
 * and manages the lifecycle (join → listen → respond → leave).
 */

import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
  type AudioReceiveStream,
  createAudioPlayer,
  type AudioPlayer,
} from "@discordjs/voice";
import type { Client, VoiceState } from "discord.js";
import { VoicePipeline, type VoicePipelineOptions } from "@octopal/voice";
import { createLogger, type VoiceConfig } from "@octopal/core";
import type { ConnectorSessionStore } from "../connector.js";
import { subscribeToUser, opusStreamToPcmMono, playPcmAudio } from "./audio-adapter.js";

const log = createLogger("discord-voice");

export interface VoiceHandlerOptions {
  client: Client;
  sessionStore: ConnectorSessionStore;
  allowedUsers: Set<string>;
  voiceConfig?: VoiceConfig;
  /** Pre-configured pipeline options (STT/TTS providers already resolved) */
  pipelineOptions: Omit<VoicePipelineOptions, "vad">;
}

interface ActiveVoiceSession {
  connection: VoiceConnection;
  pipeline: VoicePipeline;
  audioStream: AudioReceiveStream;
  audioPlayer: AudioPlayer;
  userId: string;
  guildId: string;
  channelId: string;
}

export class DiscordVoiceHandler {
  private readonly client: Client;
  private readonly sessionStore: ConnectorSessionStore;
  private readonly allowedUsers: Set<string>;
  private readonly voiceConfig?: VoiceConfig;
  private readonly pipelineOptions: Omit<VoicePipelineOptions, "vad">;

  /** Active voice sessions keyed by `guildId:userId` */
  private sessions = new Map<string, ActiveVoiceSession>();

  constructor(options: VoiceHandlerOptions) {
    this.client = options.client;
    this.sessionStore = options.sessionStore;
    this.allowedUsers = options.allowedUsers;
    this.voiceConfig = options.voiceConfig;
    this.pipelineOptions = options.pipelineOptions;
  }

  /** Start listening for voice state changes */
  start(): void {
    this.client.on("voiceStateUpdate", (oldState, newState) => {
      void this.handleVoiceStateUpdate(oldState, newState);
    });
    log.info("Voice handler started");
  }

  /** Disconnect all active voice sessions */
  async stopAll(): Promise<void> {
    for (const [key, session] of this.sessions) {
      await this.endSession(key, session);
    }
  }

  private async handleVoiceStateUpdate(
    oldState: VoiceState,
    newState: VoiceState,
  ): Promise<void> {
    const userId = newState.id;
    if (!this.allowedUsers.has(userId)) return;

    const oldChannel = oldState.channelId;
    const newChannel = newState.channelId;
    const guildId = newState.guild.id;
    const sessionKey = `${guildId}:${userId}`;

    // User left voice channel
    if (oldChannel && !newChannel) {
      const session = this.sessions.get(sessionKey);
      if (session) {
        log.info(`User ${userId} left voice channel, ending session`);
        await this.endSession(sessionKey, session);
      }
      return;
    }

    // User joined a voice channel (or switched channels)
    if (newChannel && newChannel !== oldChannel) {
      // End existing session if switching channels
      const existing = this.sessions.get(sessionKey);
      if (existing) {
        await this.endSession(sessionKey, existing);
      }

      await this.startSession(sessionKey, userId, guildId, newChannel, newState);
    }
  }

  private async startSession(
    sessionKey: string,
    userId: string,
    guildId: string,
    channelId: string,
    state: VoiceState,
  ): Promise<void> {
    try {
      const guild = state.guild;
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        log.error(`Voice channel ${channelId} not found`);
        return;
      }

      log.info(`Joining voice channel ${channel.name} for user ${userId}`);

      const connection = joinVoiceChannel({
        channelId,
        guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
      });

      // Wait for the connection to be ready
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      log.info("Voice connection ready");

      const audioPlayer = createAudioPlayer();
      connection.subscribe(audioPlayer);

      const agentSessionId = `voice-discord-${userId}`;

      // Create the voice pipeline
      const pipeline = new VoicePipeline(
        {
          ...this.pipelineOptions,
          vad: {
            silenceDurationMs: this.voiceConfig?.vadSilenceMs,
            energyThreshold: this.voiceConfig?.vadEnergyThreshold,
          },
        },
        {
          onUserSpeech: async (text) => {
            log.debug(`Processing speech: "${text}"`);
            const { response } = await this.sessionStore.sendOrRecover(
              agentSessionId,
              text,
              { inactivityTimeoutMs: 120_000 },
            );
            return response?.data?.content ?? "Sorry, I couldn't process that.";
          },
          onAudioOutput: async (pcmBuffer) => {
            await playPcmAudio(connection, pcmBuffer, audioPlayer);
          },
          onStateChange: (newState) => {
            log.debug(`Pipeline state: ${newState}`);
          },
          onError: (error, phase) => {
            log.error(`Voice pipeline error (${phase}): ${error.message}`);
          },
        },
      );

      // Subscribe to the user's audio stream
      const audioStream = subscribeToUser(connection, userId);

      // Feed audio to the pipeline
      opusStreamToPcmMono(audioStream, (pcm) => {
        try {
          pipeline.pushAudio(pcm);
        } catch (err) {
          log.error(`Error processing audio chunk: ${err instanceof Error ? err.message : err}`);
        }
      });

      pipeline.start();

      const session: ActiveVoiceSession = {
        connection,
        pipeline,
        audioStream,
        audioPlayer,
        userId,
        guildId,
        channelId,
      };

      this.sessions.set(sessionKey, session);

      // Handle disconnection
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        log.info("Voice connection disconnected");
        const s = this.sessions.get(sessionKey);
        if (s) {
          await this.endSession(sessionKey, s);
        }
      });

      log.info(`Voice session started for user ${userId}`);
    } catch (error) {
      log.error(
        `Failed to start voice session: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async endSession(
    key: string,
    session: ActiveVoiceSession,
  ): Promise<void> {
    try {
      const transcript = session.pipeline.stop();

      // Save transcript to vault if there was any conversation
      if (!transcript.isEmpty()) {
        const markdown = transcript.toMarkdown();
        const agentSessionId = `voice-discord-${session.userId}`;
        try {
          await this.sessionStore.sendOrRecover(
            agentSessionId,
            `Save this voice call transcript to the vault under Sessions/:\n\n${markdown}`,
            { inactivityTimeoutMs: 30_000 },
          );
          log.info("Voice transcript saved to vault");
        } catch (err) {
          log.error(`Failed to save transcript: ${err instanceof Error ? err.message : err}`);
        }
      }

      session.audioStream.destroy();
      session.connection.destroy();
      this.sessions.delete(key);
      log.info(`Voice session ended for user ${session.userId}`);
    } catch (error) {
      log.error(
        `Error ending voice session: ${error instanceof Error ? error.message : error}`,
      );
      this.sessions.delete(key);
    }
  }
}
