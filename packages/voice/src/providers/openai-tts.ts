/**
 * OpenAI TTS provider.
 *
 * Synthesizes text to PCM audio using the OpenAI TTS API.
 * Requests raw PCM output at the pipeline's standard sample rate.
 */

import OpenAI from "openai";
import type { TTSOptions, TTSProvider } from "../types.js";
import { PIPELINE_AUDIO_FORMAT } from "../types.js";

export interface OpenAITTSConfig {
  /** OpenAI API key. Falls back to OPENAI_API_KEY env var. */
  apiKey?: string;
  /** Model name. Default: "tts-1" */
  model?: string;
  /** Default voice. Default: "alloy" */
  voice?: string;
}

type TTSVoice = "alloy" | "ash" | "coral" | "echo" | "fable" | "onyx" | "nova" | "sage" | "shimmer";

export class OpenAITTSProvider implements TTSProvider {
  readonly name = "openai-tts";
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly defaultVoice: TTSVoice;

  constructor(config?: OpenAITTSConfig) {
    this.client = new OpenAI({ apiKey: config?.apiKey });
    this.model = config?.model ?? "tts-1";
    this.defaultVoice = (config?.voice ?? "alloy") as TTSVoice;
  }

  async synthesize(text: string, options?: TTSOptions): Promise<Buffer> {
    const voice = (options?.voice ?? this.defaultVoice) as TTSVoice;
    const speed = options?.speed ?? 1.0;

    const response = await this.client.audio.speech.create({
      model: this.model,
      voice,
      input: text,
      speed,
      response_format: "pcm", // raw s16le 24kHz mono
    });

    const rawPcm = Buffer.from(await response.arrayBuffer());

    // OpenAI TTS returns 24kHz PCM; resample to pipeline format (48kHz) if needed
    if (PIPELINE_AUDIO_FORMAT.sampleRate === 24_000) {
      return rawPcm;
    }

    return resample(rawPcm, 24_000, PIPELINE_AUDIO_FORMAT.sampleRate);
  }
}

/** Simple linear interpolation resampler for s16le mono PCM */
function resample(
  input: Buffer,
  fromRate: number,
  toRate: number,
): Buffer {
  if (fromRate === toRate) return input;

  const ratio = toRate / fromRate;
  const inputSamples = input.length / 2;
  const outputSamples = Math.floor(inputSamples * ratio);
  const output = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i / ratio;
    const srcIndex = Math.floor(srcPos);
    const frac = srcPos - srcIndex;

    const s0 = input.readInt16LE(Math.min(srcIndex, inputSamples - 1) * 2);
    const s1 = input.readInt16LE(
      Math.min(srcIndex + 1, inputSamples - 1) * 2,
    );

    const interpolated = Math.round(s0 + frac * (s1 - s0));
    output.writeInt16LE(
      Math.max(-32768, Math.min(32767, interpolated)),
      i * 2,
    );
  }

  return output;
}
