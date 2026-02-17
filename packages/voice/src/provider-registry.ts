/**
 * Provider registry for STT and TTS providers.
 *
 * Providers register themselves by name. The pipeline resolves
 * providers from config at startup time.
 */

import type { STTProvider, TTSProvider } from "./types.js";

export class ProviderRegistry {
  private sttProviders = new Map<string, STTProvider>();
  private ttsProviders = new Map<string, TTSProvider>();

  registerSTT(provider: STTProvider): void {
    this.sttProviders.set(provider.name, provider);
  }

  registerTTS(provider: TTSProvider): void {
    this.ttsProviders.set(provider.name, provider);
  }

  getSTT(name: string): STTProvider {
    const provider = this.sttProviders.get(name);
    if (!provider) {
      const available = [...this.sttProviders.keys()].join(", ") || "(none)";
      throw new Error(
        `STT provider "${name}" not found. Available: ${available}`,
      );
    }
    return provider;
  }

  getTTS(name: string): TTSProvider {
    const provider = this.ttsProviders.get(name);
    if (!provider) {
      const available = [...this.ttsProviders.keys()].join(", ") || "(none)";
      throw new Error(
        `TTS provider "${name}" not found. Available: ${available}`,
      );
    }
    return provider;
  }

  listSTT(): string[] {
    return [...this.sttProviders.keys()];
  }

  listTTS(): string[] {
    return [...this.ttsProviders.keys()];
  }
}
