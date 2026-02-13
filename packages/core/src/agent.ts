import { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import type { SessionEventHandler } from "@github/copilot-sdk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { VaultManager } from "./vault.js";
import { ParaManager } from "./para.js";
import { TaskManager } from "./tasks.js";
import { SessionLogger } from "./session-logger.js";
import { buildVaultTools } from "./tools.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import type { OctopalConfig } from "./types.js";
import type { Scheduler } from "./scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class OctopalAgent {
  readonly client: CopilotClient;
  readonly vault: VaultManager;
  readonly para: ParaManager;
  private tasks: TaskManager;
  private scheduler?: Scheduler;

  constructor(private config: OctopalConfig) {
    this.client = new CopilotClient({
      logLevel: "warning",
    });
    this.vault = new VaultManager(config.vault);
    this.para = new ParaManager(this.vault);
    this.tasks = new TaskManager();
  }

  /** Attach the scheduler so it's available to agent tools */
  setScheduler(scheduler: Scheduler): void {
    this.scheduler = scheduler;
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
  }): Promise<CopilotSession> {
    const vaultStructure = await this.para.getStructure();

    // Load user-defined conventions if they exist
    let conventions = "";
    try {
      conventions = await this.vault.readFile(".octopal/conventions.md");
    } catch {
      // No conventions file — use defaults only
    }

    // Load user identity if it exists
    let identity = "";
    try {
      identity = await readFileIfExists(path.join(this.config.configDir, "identity.md"));
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

    const session = await this.client.createSession({
      model: "claude-sonnet-4",
      streaming: true,
      workingDirectory: this.vault.root,
      systemMessage: {
        mode: "append",
        content: promptContent,
      },
      skillDirectories: [
        path.resolve(__dirname, "../../../skills"),                // bundled (para, etc.)
        path.join(this.vault.root, ".octopal/skills"),            // vault skills
        path.join(this.config.configDir, "skills"),               // local (~/.octopal/skills/)
      ],
      ...(options?.disabledSkills?.length ? { disabledSkills: options.disabledSkills } : {}),
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options?.infiniteSessions ? { infiniteSessions: { enabled: true } } : {}),
      tools: [
        ...buildVaultTools({
          vault: this.vault,
          para: this.para,
          tasks: this.tasks,
          client: this.client,
          scheduler: this.scheduler,
        }),
        ...(options?.extraTools ?? []),
      ],
    });

    if (options?.onEvent) {
      session.on(options.onEvent);
    }

    // Attach session logger unless explicitly disabled
    if (options?.sessionLogging !== false) {
      const logSessionId = options?.sessionId ?? session.sessionId ?? "unknown";
      const logger = new SessionLogger(this.vault, logSessionId);
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
    const response = await session.sendAndWait({ prompt }, timeout);
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
