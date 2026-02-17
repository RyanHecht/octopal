/**
 * Core type definitions for the @octopal/voice package.
 *
 * These interfaces define the contracts for STT/TTS providers,
 * voice activity detection, and the voice pipeline.
 */

// ── Audio Format ─────────────────────────────────────────────────

export interface AudioFormat {
  /** Sample rate in Hz (e.g. 48000) */
  sampleRate: number;
  /** Number of audio channels (1 = mono) */
  channels: number;
  /** PCM encoding */
  encoding: "s16le";
}

/** Standard format used internally by the voice pipeline */
export const PIPELINE_AUDIO_FORMAT: AudioFormat = {
  sampleRate: 48_000,
  channels: 1,
  encoding: "s16le",
};

// ── STT (Speech-to-Text) ────────────────────────────────────────

export interface STTResult {
  /** Transcribed text */
  text: string;
  /** Confidence score (0–1), if available */
  confidence?: number;
  /** Word/segment-level timing, if available */
  segments?: Array<{ text: string; start: number; end: number }>;
}

export interface STTOptions {
  /** Language hint (e.g. "en") */
  language?: string;
  /** Optional prompt/context to improve transcription accuracy */
  prompt?: string;
}

export interface STTProvider {
  readonly name: string;
  /** Transcribe a PCM audio buffer to text */
  transcribe(
    audio: Buffer,
    format: AudioFormat,
    options?: STTOptions,
  ): Promise<STTResult>;
}

// ── TTS (Text-to-Speech) ────────────────────────────────────────

export interface TTSOptions {
  /** Voice identifier (provider-specific) */
  voice?: string;
  /** Speech speed multiplier (1.0 = normal) */
  speed?: number;
}

export interface TTSProvider {
  readonly name: string;
  /**
   * Synthesize text to PCM audio.
   * Returns a buffer in the pipeline's standard audio format (48kHz mono s16le).
   */
  synthesize(text: string, options?: TTSOptions): Promise<Buffer>;
}

// ── VAD (Voice Activity Detection) ──────────────────────────────

export interface VADOptions {
  /** Silence duration (ms) before considering speech ended. Default: 800 */
  silenceDurationMs?: number;
  /** RMS energy threshold to detect speech (0–1 normalized). Default: 0.01 */
  energyThreshold?: number;
  /** Minimum speech duration (ms) to emit an utterance. Default: 200 */
  minSpeechDurationMs?: number;
}

export type VADEvent =
  | { type: "speech-start" }
  | { type: "speech-end"; audio: Buffer };

// ── Voice Pipeline ──────────────────────────────────────────────

export type VoicePipelineState =
  | "idle"
  | "listening"
  | "processing"
  | "speaking";

export interface PipelineCallbacks {
  /** Called when user speech is transcribed. Must return the agent's text response. */
  onUserSpeech(text: string): Promise<string>;
  /** Called when TTS audio is ready to play */
  onAudioOutput(audio: Buffer): Promise<void>;
  /** Called on pipeline state changes */
  onStateChange?(state: VoicePipelineState): void;
  /** Called on errors (pipeline continues running) */
  onError?(error: Error, phase: "stt" | "tts" | "vad"): void;
}

export interface VoicePipelineOptions {
  stt: STTProvider;
  tts: TTSProvider;
  vad?: VADOptions;
  /** Audio format of incoming audio. Default: 48kHz mono s16le */
  inputFormat?: AudioFormat;
  /** TTS voice/speed options */
  ttsOptions?: TTSOptions;
  /** STT options (language, prompt) */
  sttOptions?: STTOptions;
}

// ── Transcript ──────────────────────────────────────────────────

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}
