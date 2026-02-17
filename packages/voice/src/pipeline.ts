/**
 * VoicePipeline — orchestrates the full voice interaction loop.
 *
 * Audio In → VAD → STT → Agent callback → TTS → Audio Out
 *
 * State machine:
 *   idle → listening → processing → speaking → idle (→ listening ...)
 *
 * The pipeline does NOT own the audio transport. Platform adapters
 * feed PCM chunks via pushAudio() and receive synthesized audio
 * via the onAudioOutput callback.
 */

import { createLogger } from "@octopal/core";
import { VADDetector } from "./vad.js";
import type {
  PipelineCallbacks,
  VADEvent,
  VoicePipelineOptions,
  VoicePipelineState,
} from "./types.js";
import { PIPELINE_AUDIO_FORMAT } from "./types.js";
import { TranscriptAccumulator } from "./transcript.js";

const log = createLogger("voice-pipeline");

export class VoicePipeline {
  private state: VoicePipelineState = "idle";
  private readonly vad: VADDetector;
  private readonly options: VoicePipelineOptions;
  private readonly callbacks: PipelineCallbacks;
  private readonly transcript = new TranscriptAccumulator();
  private stopped = false;
  private processing = false;

  constructor(options: VoicePipelineOptions, callbacks: PipelineCallbacks) {
    this.options = options;
    this.callbacks = callbacks;

    const format = options.inputFormat ?? PIPELINE_AUDIO_FORMAT;
    this.vad = new VADDetector(options.vad, format);

    this.vad.on("vad", (event: VADEvent) => {
      if (this.stopped) return;

      if (event.type === "speech-start") {
        log.debug("Speech started");
      } else if (event.type === "speech-end") {
        log.debug("Speech ended, processing utterance");
        void this.handleUtterance(event.audio);
      }
    });
  }

  /** Start the pipeline — begin listening for speech */
  start(): void {
    this.stopped = false;
    this.setState("listening");
    log.info("Voice pipeline started");
  }

  /** Stop the pipeline and return the transcript */
  stop(): TranscriptAccumulator {
    this.stopped = true;
    this.vad.reset();
    this.setState("idle");
    log.info("Voice pipeline stopped");
    return this.transcript;
  }

  /** Feed PCM audio from the platform adapter */
  pushAudio(chunk: Buffer): void {
    if (this.stopped || this.state !== "listening") return;
    this.vad.processChunk(chunk);
  }

  /** Signal push-to-talk release (optional, platform-specific) */
  pttRelease(): void {
    // Force end-of-speech if VAD hasn't triggered yet
    if (this.state === "listening") {
      this.vad.reset();
    }
  }

  getState(): VoicePipelineState {
    return this.state;
  }

  getTranscript(): TranscriptAccumulator {
    return this.transcript;
  }

  private setState(newState: VoicePipelineState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.callbacks.onStateChange?.(newState);
  }

  private async handleUtterance(audio: Buffer): Promise<void> {
    // Prevent concurrent processing — drop overlapping utterances
    if (this.processing) {
      log.debug("Already processing an utterance, dropping");
      return;
    }
    this.processing = true;
    this.setState("processing");

    try {
      // STT
      const format = this.options.inputFormat ?? PIPELINE_AUDIO_FORMAT;
      const sttResult = await this.options.stt.transcribe(
        audio,
        format,
        this.options.sttOptions,
      );

      const userText = sttResult.text.trim();
      if (!userText) {
        log.debug("STT returned empty text, resuming listening");
        this.processing = false;
        this.setState("listening");
        return;
      }

      log.info(`User said: "${userText}"`);
      this.transcript.addEntry("user", userText);

      // Get agent response
      const responseText = await this.callbacks.onUserSpeech(userText);

      if (this.stopped) {
        this.processing = false;
        return;
      }

      if (!responseText.trim()) {
        log.debug("Agent returned empty response, resuming listening");
        this.processing = false;
        this.setState("listening");
        return;
      }

      log.info(`Agent responds: "${responseText.substring(0, 80)}..."`);
      this.transcript.addEntry("assistant", responseText);

      // TTS
      this.setState("speaking");
      const ttsAudio = await this.options.tts.synthesize(
        responseText,
        this.options.ttsOptions,
      );

      if (this.stopped) {
        this.processing = false;
        return;
      }

      await this.callbacks.onAudioOutput(ttsAudio);

      // Resume listening
      this.processing = false;
      this.setState("listening");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const phase = this.state === "processing" ? "stt" : "tts";
      log.error(`Voice pipeline error (${phase}): ${err.message}`);
      this.callbacks.onError?.(err, phase as "stt" | "tts");

      // Resume listening after error
      this.processing = false;
      if (!this.stopped) {
        this.setState("listening");
      }
    }
  }
}
