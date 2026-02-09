export { OctopalAgent } from "./agent.js";
export { VaultManager } from "./vault.js";
export { ParaManager, ParaCategory } from "./para.js";
export { TaskManager, type Task, TaskStatus, TaskPriority } from "./tasks.js";
export { SYSTEM_PROMPT, INGEST_INSTRUCTIONS, SETUP_PROMPT } from "./prompts.js";
export { buildVaultTools, buildCopilotTools, buildAllVaultTools } from "./tools.js";
export type { OctopalToolDef, ToolDeps } from "./tools.js";
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
export { IngestPipeline } from "./ingest.js";
export { loadConfig, saveConfig, isConfigured } from "./config.js";
export type { OctopalUserConfig, ResolvedConfig } from "./config.js";
export type * from "./types.js";
