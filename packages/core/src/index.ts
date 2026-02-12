export { OctopalAgent } from "./agent.js";
export { VaultManager } from "./vault.js";
export { ParaManager, ParaCategory } from "./para.js";
export { TaskManager, type Task, TaskStatus, TaskPriority } from "./tasks.js";
export { SYSTEM_PROMPT, SETUP_PROMPT } from "./prompts.js";
export { buildVaultTools } from "./tools.js";
export type { ToolDeps } from "./tools.js";
export {
  hashPassword,
  verifyPassword,
  mintToken,
  verifyToken,
  generateTokenSecret,
} from "./auth.js";
export type { TokenPayload } from "./auth.js";
export {
  buildKnowledgeIndex,
  deterministicMatch,
  formatIndexForLLM,
  slugify,
  KNOWLEDGE_DIR,
  KNOWLEDGE_CATEGORIES,
} from "./knowledge.js";
export type { KnowledgeEntry, KnowledgeIndex, KnowledgeCategory } from "./knowledge.js";
export { runPreprocessor } from "./preprocessor.js";
export type { PreprocessorResult } from "./preprocessor.js";
export { loadConfig, saveConfig, isConfigured, CONFIG_TEMPLATE } from "./config.js";
export type { OctopalUserConfig, ResolvedConfig, ServerConfig, DiscordConfig } from "./config.js";
export type * from "./types.js";
export type { OctopalConnector, InboundMessage, OutboundMessage } from "./connector.js";
