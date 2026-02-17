/**
 * Discord audio adapter.
 *
 * Bridges between Discord.js voice audio (Opus) and the
 * @octopal/voice pipeline (PCM s16le 48kHz mono).
 *
 * - Input: Decodes user's Opus AudioReceiveStream → PCM for the pipeline
 * - Output: Wraps PCM audio buffer → AudioResource for Discord playback
 */

import {
  type VoiceConnection,
  type AudioReceiveStream,
  createAudioResource,
  createAudioPlayer,
  AudioPlayerStatus,
  StreamType,
  EndBehaviorType,
  type AudioPlayer,
} from "@discordjs/voice";
import { Readable } from "node:stream";
import { createLogger } from "@octopal/core";

const log = createLogger("discord-audio");

/**
 * Subscribe to a specific user's audio in a voice connection.
 * Returns a transform that emits PCM s16le 48kHz stereo frames,
 * which we downmix to mono for the pipeline.
 */
export function subscribeToUser(
  connection: VoiceConnection,
  userId: string,
): AudioReceiveStream {
  const receiver = connection.receiver;
  const stream = receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.Manual },
    objectMode: false,
  });
  return stream;
}

/**
 * Convert an Opus AudioReceiveStream to PCM s16le 48kHz mono chunks.
 * Discord delivers decoded PCM as s16le stereo 48kHz via the opus stream.
 * We downmix stereo to mono.
 */
export function opusStreamToPcmMono(
  opusStream: AudioReceiveStream,
  onChunk: (pcm: Buffer) => void,
): void {
  // The @discordjs/opus decoder outputs s16le stereo 48kHz
  opusStream.on("data", (chunk: Buffer) => {
    const mono = stereoToMono(chunk);
    onChunk(mono);
  });

  opusStream.on("error", (err) => {
    log.error(`Opus stream error: ${err.message}`);
  });
}

/** Downmix stereo s16le PCM to mono by averaging L/R channels */
function stereoToMono(stereo: Buffer): Buffer {
  const sampleCount = stereo.length / 4; // 2 channels × 2 bytes per sample
  const mono = Buffer.alloc(sampleCount * 2);

  for (let i = 0; i < sampleCount; i++) {
    const left = stereo.readInt16LE(i * 4);
    const right = stereo.readInt16LE(i * 4 + 2);
    const mixed = Math.round((left + right) / 2);
    mono.writeInt16LE(Math.max(-32768, Math.min(32767, mixed)), i * 2);
  }

  return mono;
}

/**
 * Play a PCM s16le 48kHz mono buffer through a Discord voice connection.
 * Returns a promise that resolves when playback completes.
 */
export async function playPcmAudio(
  connection: VoiceConnection,
  pcmBuffer: Buffer,
  player?: AudioPlayer,
): Promise<AudioPlayer> {
  const audioPlayer = player ?? createAudioPlayer();

  // Convert mono to stereo for Discord (expects s16le stereo 48kHz)
  const stereo = monoToStereo(pcmBuffer);

  const stream = Readable.from(stereo);
  const resource = createAudioResource(stream, {
    inputType: StreamType.Raw,
  });

  connection.subscribe(audioPlayer);
  audioPlayer.play(resource);

  return new Promise((resolve, reject) => {
    const onIdle = () => {
      audioPlayer.removeListener("error", onError);
      resolve(audioPlayer);
    };
    const onError = (err: Error) => {
      audioPlayer.removeListener(AudioPlayerStatus.Idle, onIdle);
      reject(err);
    };
    audioPlayer.once(AudioPlayerStatus.Idle, onIdle);
    audioPlayer.once("error", onError);
  });
}

/** Convert mono s16le PCM to stereo by duplicating each sample */
function monoToStereo(mono: Buffer): Buffer {
  const sampleCount = mono.length / 2;
  const stereo = Buffer.alloc(sampleCount * 4);

  for (let i = 0; i < sampleCount; i++) {
    const sample = mono.readInt16LE(i * 2);
    stereo.writeInt16LE(sample, i * 4);      // left
    stereo.writeInt16LE(sample, i * 4 + 2);  // right
  }

  return stereo;
}
