/**
 * OpenAI Whisper STT provider.
 *
 * Transcribes PCM audio using the OpenAI Whisper API.
 * Converts raw PCM to WAV format for the API call.
 */

import OpenAI, { toFile } from "openai";
import type { AudioFormat, STTOptions, STTProvider, STTResult } from "../types.js";

export interface OpenAISTTConfig {
  /** OpenAI API key. Falls back to OPENAI_API_KEY env var. */
  apiKey?: string;
  /** Model name. Default: "whisper-1" */
  model?: string;
}

export class OpenAISTTProvider implements STTProvider {
  readonly name = "openai-whisper";
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config?: OpenAISTTConfig) {
    this.client = new OpenAI({ apiKey: config?.apiKey });
    this.model = config?.model ?? "whisper-1";
  }

  async transcribe(
    audio: Buffer,
    format: AudioFormat,
    options?: STTOptions,
  ): Promise<STTResult> {
    const wav = pcmToWav(audio, format);
    const file = await toFile(wav, "audio.wav", { type: "audio/wav" });

    const response = await this.client.audio.transcriptions.create({
      model: this.model,
      file,
      language: options?.language,
      prompt: options?.prompt,
      response_format: "verbose_json",
    });

    return {
      text: response.text,
      segments: response.segments?.map((s) => ({
        text: s.text,
        start: s.start,
        end: s.end,
      })),
    };
  }
}

/** Convert raw PCM s16le buffer to WAV format */
function pcmToWav(pcm: Buffer, format: AudioFormat): Buffer {
  const byteRate = format.sampleRate * format.channels * 2; // 2 bytes per sample (s16le)
  const blockAlign = format.channels * 2;
  const headerSize = 44;
  const dataSize = pcm.length;
  const fileSize = headerSize + dataSize;

  const header = Buffer.alloc(headerSize);
  let offset = 0;

  // RIFF header
  header.write("RIFF", offset);
  offset += 4;
  header.writeUInt32LE(fileSize - 8, offset);
  offset += 4;
  header.write("WAVE", offset);
  offset += 4;

  // fmt sub-chunk
  header.write("fmt ", offset);
  offset += 4;
  header.writeUInt32LE(16, offset); // sub-chunk size
  offset += 4;
  header.writeUInt16LE(1, offset); // PCM format
  offset += 2;
  header.writeUInt16LE(format.channels, offset);
  offset += 2;
  header.writeUInt32LE(format.sampleRate, offset);
  offset += 4;
  header.writeUInt32LE(byteRate, offset);
  offset += 4;
  header.writeUInt16LE(blockAlign, offset);
  offset += 2;
  header.writeUInt16LE(16, offset); // bits per sample
  offset += 2;

  // data sub-chunk
  header.write("data", offset);
  offset += 4;
  header.writeUInt32LE(dataSize, offset);

  return Buffer.concat([header, pcm]);
}
