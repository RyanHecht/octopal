import { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import type { SessionEventHandler } from "@github/copilot-sdk";
import { VaultManager } from "./vault.js";
import { ParaManager } from "./para.js";
import { TaskManager } from "./tasks.js";
import { buildAllVaultTools } from "./tools.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import type { OctopalConfig } from "./types.js";

export class OctopalAgent {
  readonly client: CopilotClient;
  readonly vault: VaultManager;
  private para: ParaManager;
  private tasks: TaskManager;

  constructor(private config: OctopalConfig) {
    this.client = new CopilotClient({
      logLevel: "warning",
    });
    this.vault = new VaultManager(config.vault);
    this.para = new ParaManager(this.vault);
    this.tasks = new TaskManager();
  }

  async init(): Promise<void> {
    await this.client.start();
    await this.vault.init();
    await this.para.ensureStructure();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async createSession(options?: { onEvent?: SessionEventHandler }): Promise<CopilotSession> {
    const vaultStructure = await this.para.getStructure();

    // Load user-defined conventions if they exist
    let conventions = "";
    try {
      conventions = await this.vault.readFile(".octopal/conventions.md");
    } catch {
      // No conventions file — use defaults only
    }

    let promptContent = `${SYSTEM_PROMPT}\n\n## Current Vault Structure\n\`\`\`\n${vaultStructure}\n\`\`\``;
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
      tools: buildAllVaultTools({
        vault: this.vault,
        para: this.para,
        tasks: this.tasks,
      }),
    });

    if (options?.onEvent) {
      session.on(options.onEvent);
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
