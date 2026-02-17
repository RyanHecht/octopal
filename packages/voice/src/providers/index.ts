/**
 * Register all built-in STT/TTS providers.
 */

import type { ProviderRegistry } from "../provider-registry.js";
import { OpenAISTTProvider, type OpenAISTTConfig } from "./openai-stt.js";
import { OpenAITTSProvider, type OpenAITTSConfig } from "./openai-tts.js";

export interface BuiltinProviderConfig {
  openai?: OpenAISTTConfig & OpenAITTSConfig;
}

/**
 * Register all built-in providers with the registry.
 * Call this at startup before resolving providers from config.
 */
export function registerBuiltinProviders(
  registry: ProviderRegistry,
  config?: BuiltinProviderConfig,
): void {
  registry.registerSTT(new OpenAISTTProvider(config?.openai));
  registry.registerTTS(new OpenAITTSProvider(config?.openai));
}
