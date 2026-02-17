/**
 * Energy-based Voice Activity Detection (VAD).
 *
 * Processes PCM s16le audio chunks and detects speech boundaries
 * by tracking RMS energy levels. Emits speech-start when energy
 * exceeds threshold, and speech-end (with buffered audio) after
 * sustained silence.
 */

import { EventEmitter } from "node:events";
import type { VADOptions, VADEvent, AudioFormat } from "./types.js";
import { PIPELINE_AUDIO_FORMAT } from "./types.js";

const DEFAULT_SILENCE_MS = 800;
const DEFAULT_ENERGY_THRESHOLD = 0.01;
const DEFAULT_MIN_SPEECH_MS = 200;

// s16le: 2 bytes per sample
const BYTES_PER_SAMPLE = 2;
// Max absolute value for signed 16-bit
const S16_MAX = 32768;

export class VADDetector extends EventEmitter {
  private readonly silenceDurationMs: number;
  private readonly energyThreshold: number;
  private readonly minSpeechDurationMs: number;
  private readonly sampleRate: number;

  private isSpeaking = false;
  private speechBuffers: Buffer[] = [];
  private silenceSamples = 0;
  private speechSamples = 0;

  constructor(options?: VADOptions, format?: AudioFormat) {
    super();
    this.silenceDurationMs = options?.silenceDurationMs ?? DEFAULT_SILENCE_MS;
    this.energyThreshold = options?.energyThreshold ?? DEFAULT_ENERGY_THRESHOLD;
    this.minSpeechDurationMs =
      options?.minSpeechDurationMs ?? DEFAULT_MIN_SPEECH_MS;
    this.sampleRate = format?.sampleRate ?? PIPELINE_AUDIO_FORMAT.sampleRate;
  }

  /** Process a chunk of PCM s16le audio */
  processChunk(chunk: Buffer): void {
    const energy = this.computeRMS(chunk);
    const chunkSamples = chunk.length / BYTES_PER_SAMPLE;
    const isSpeech = energy >= this.energyThreshold;

    if (isSpeech) {
      this.silenceSamples = 0;

      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.speechSamples = 0;
        this.speechBuffers = [];
        this.emit("vad", { type: "speech-start" } satisfies VADEvent);
      }

      this.speechSamples += chunkSamples;
      this.speechBuffers.push(chunk);
    } else if (this.isSpeaking) {
      // Still collecting during silence gap
      this.speechBuffers.push(chunk);
      this.silenceSamples += chunkSamples;

      const silenceMs = (this.silenceSamples / this.sampleRate) * 1000;
      if (silenceMs >= this.silenceDurationMs) {
        this.endSpeech();
      }
    }
    // If not speaking and no speech detected, discard
  }

  /** Reset detector state */
  reset(): void {
    this.isSpeaking = false;
    this.speechBuffers = [];
    this.silenceSamples = 0;
    this.speechSamples = 0;
  }

  private endSpeech(): void {
    const speechDurationMs = (this.speechSamples / this.sampleRate) * 1000;

    if (speechDurationMs >= this.minSpeechDurationMs) {
      // Trim trailing silence from the buffer
      const silenceBytes = this.silenceSamples * BYTES_PER_SAMPLE;
      const fullAudio = Buffer.concat(this.speechBuffers);
      const trimmedAudio = fullAudio.subarray(
        0,
        fullAudio.length - silenceBytes,
      );

      this.emit("vad", {
        type: "speech-end",
        audio: trimmedAudio,
      } satisfies VADEvent);
    }

    this.reset();
  }

  /** Compute RMS energy of a PCM s16le buffer, normalized to 0–1 */
  private computeRMS(chunk: Buffer): number {
    const numSamples = chunk.length / BYTES_PER_SAMPLE;
    if (numSamples === 0) return 0;

    let sumSquares = 0;
    for (let i = 0; i < chunk.length; i += BYTES_PER_SAMPLE) {
      const sample = chunk.readInt16LE(i) / S16_MAX;
      sumSquares += sample * sample;
    }

    return Math.sqrt(sumSquares / numSamples);
  }
}
