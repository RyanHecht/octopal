import { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import type { SessionEventHandler } from "@github/copilot-sdk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { VaultManager } from "./vault.js";
import { buildVaultFileUrl } from "./wikilinks.js";
import { ParaManager } from "./para.js";
import { TaskManager } from "./tasks.js";
import { SessionLogger } from "./session-logger.js";
import { buildVaultTools } from "./tools.js";
import { SYSTEM_PROMPT, VOICE_PROMPT_ADDENDUM } from "./prompts.js";
import { QmdSearch } from "./qmd.js";
import { buildSessionHooks, type KnowledgeOperation } from "./hooks.js";
import { BackgroundTaskManager } from "./background-tasks.js";
import { createLogger } from "./log.js";
import type { OctopalConfig } from "./types.js";
import type { ConnectorRegistryLike } from "./types.js";
import type { Scheduler } from "./scheduler.js";

const log = createLogger("agent");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class OctopalAgent {
  readonly client: CopilotClient;
  readonly vault: VaultManager;
  readonly para: ParaManager;
  readonly qmd: QmdSearch;
  private tasks: TaskManager;
  private scheduler?: Scheduler;
  private connectors?: ConnectorRegistryLike;
  readonly backgroundTasks = new BackgroundTaskManager();

  constructor(private config: OctopalConfig) {
    this.client = new CopilotClient({
      logLevel: "warning",
    });
    this.vault = new VaultManager(config.vault);
    this.para = new ParaManager(this.vault);
    this.tasks = new TaskManager();
    this.qmd = new QmdSearch(config.vault.localPath);
  }

  /** Attach the scheduler so it's available to agent tools */
  setScheduler(scheduler: Scheduler): void {
    this.scheduler = scheduler;
  }

  /** Attach the connector registry so tools and session context can use it */
  setConnectorRegistry(registry: ConnectorRegistryLike): void {
    this.connectors = registry;
  }

  async init(): Promise<void> {
    await this.client.start();
    await this.vault.init();
    await this.para.ensureStructure();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async createSession(options?: {
    onEvent?: SessionEventHandler;
    disabledSkills?: string[];
    sessionId?: string;
    infiniteSessions?: boolean;
    sessionLogging?: boolean;
    extraTools?: import("@github/copilot-sdk").Tool<any>[];
    /** Session mode. "voice" applies conversational prompt and filters tools. */
    mode?: "text" | "voice";
  }): Promise<CopilotSession> {
    const vaultStructure = await this.para.getStructure();

    // Load user-defined conventions if they exist
    let conventions = "";
    try {
      conventions = await this.vault.readFile("Meta/conventions.md");
    } catch {
      // No conventions file — use defaults only
    }

    // Load user identity if it exists
    let identity = "";
    try {
      identity = await this.vault.readFile("Meta/identity.md");
    } catch {
      // No identity file
    }

    let promptContent = `${SYSTEM_PROMPT}\n\n## Current Vault Structure\n\`\`\`\n${vaultStructure}\n\`\`\``;
    if (identity) {
      promptContent += `\n\n## About the User\n${identity}`;
    }
    if (conventions) {
      promptContent += `\n\n## User Conventions\n${conventions}`;
    }

    // Inject connected devices context
    if (this.connectors) {
      const devices = this.connectors.list();
      if (devices.length > 0) {
        const lines = devices.map((d) => {
          const caps = d.capabilities.length > 0 ? d.capabilities.join(", ") : "none";
          return `- **${d.name}**: ${caps}`;
        });
        promptContent += `\n\n## Connected Devices\n${lines.join("\n")}`;
      }
    }

    // Inject web viewer context when available
    if (this.config.vaultBaseUrl) {
      const exampleUrl = buildVaultFileUrl(this.config.vaultBaseUrl, "path/to/Note.md", this.config.vaultPathPrefix);
      promptContent += `\n\n## Web Viewer\nA web-based vault viewer is available at ${this.config.vaultBaseUrl}. When referencing vault notes, format them as clickable markdown links: [Note Title](${exampleUrl}) instead of [[wikilinks]]. This lets users click through to view the note directly. For notes you're unsure about the path for, use [[wikilinks]] as usual — they'll be resolved automatically.`;
    }

    // Append voice mode instructions when in voice mode
    const isVoice = options?.mode === "voice";
    if (isVoice) {
      promptContent += VOICE_PROMPT_ADDENDUM;
    }

    // Build hooks for automatic knowledge retrieval and ingestion
    const knowledgeOps: KnowledgeOperation[] = [];

    // Create session logger early so hooks can reference it
    let logger: SessionLogger | undefined;
    if (options?.sessionLogging !== false) {
      const logSessionId = options?.sessionId ?? `session-${Date.now()}`;
      logger = new SessionLogger(this.vault, logSessionId);
    }

    const hooks = buildSessionHooks({
      client: this.client,
      vault: this.vault,
      qmd: this.qmd,
      knowledgeOps,
      logger,
      backgroundTasks: this.backgroundTasks,
      sessionId: options?.sessionId,
    });

    const session = await this.client.createSession({
      model: "claude-sonnet-4",
      streaming: true,
      workingDirectory: this.vault.root,
      systemMessage: {
        mode: "append",
        content: promptContent,
      },
      hooks,
      skillDirectories: [
        path.resolve(__dirname, "../../../builtin-skills"),         // bundled (para, etc.)
        path.join(this.vault.root, "Meta/skills"),                 // vault skills
        path.join(this.config.configDir, "skills"),               // local (~/.octopal/skills/)
      ],
      ...(options?.disabledSkills?.length ? { disabledSkills: options.disabledSkills } : {}),
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options?.infiniteSessions ? { infiniteSessions: { enabled: true } } : {}),
      tools: [
        ...filterTools(buildVaultTools({
          vault: this.vault,
          para: this.para,
          tasks: this.tasks,
          client: this.client,
          scheduler: this.scheduler,
          connectors: this.connectors,
          qmd: this.qmd,
          backgroundTasks: this.backgroundTasks,
          getAgent: () => this,
        }), isVoice),
        ...(options?.extraTools ?? []),
      ],
    });

    if (options?.onEvent) {
      session.on(options.onEvent);
    }

    // Attach session logger
    if (logger) {
      logger.attach(session);
    }

    return session;
  }

  /** Send a prompt and wait for the agent to finish processing */
  async sendAndWait(
    session: CopilotSession,
    prompt: string,
    timeout = 300_000,
  ): Promise<string> {
    const done = log.timed("LLM call", "info");
    const response = await session.sendAndWait({ prompt }, timeout);
    done();
    return response?.data?.content ?? "";
  }

  /** One-shot: create a session, send a prompt, get a response, clean up */
  async run(prompt: string, options?: { onEvent?: SessionEventHandler }): Promise<string> {
    const session = await this.createSession(options);
    try {
      return await this.sendAndWait(session, prompt);
    } finally {
      await session.destroy();
    }
  }
}

async function readFileIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/** Tools allowed in voice mode — read-only vault access + background task management */
const VOICE_ALLOWED_TOOLS = new Set([
  "search_vault",
  "read_note",
  "read_vault_structure",
  "list_category",
  "spawn_background_task",
  "list_background_tasks",
  "kill_background_task",
]);

function filterTools(
  tools: import("@github/copilot-sdk").Tool<any>[],
  isVoice: boolean,
): import("@github/copilot-sdk").Tool<any>[] {
  if (!isVoice) return tools;
  return tools.filter((t) => VOICE_ALLOWED_TOOLS.has(t.name));
}
