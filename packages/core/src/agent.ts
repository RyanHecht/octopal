import { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import type { SessionEventHandler } from "@github/copilot-sdk";
import { VaultManager } from "./vault.js";
import { ParaManager } from "./para.js";
import { TaskManager } from "./tasks.js";
import { buildAllVaultTools } from "./tools.js";
import type { OctopalConfig } from "./types.js";

const SYSTEM_PROMPT = `You are Octopal, a personal knowledge management assistant that implements the PARA method.

## The PARA Method
- **Projects**: Active efforts with a clear outcome and deadline (e.g., "Launch website", "Plan vacation")
- **Areas**: Ongoing responsibilities with no end date (e.g., "Health", "Finances", "Career")
- **Resources**: Topics of interest or reference material (e.g., "TypeScript", "Recipes", "Book notes")
- **Archives**: Completed or inactive items from the above categories

## Your Role
When the user gives you notes, brain dumps, transcripts, or other raw input:
1. Understand the content and extract key information
2. Decide where it belongs in the PARA structure
3. Create or update notes in the appropriate location
4. Extract any actionable items and create tasks using Obsidian Tasks format
5. Use the knowledge context provided to enrich your notes — use full names, add [[wikilinks]] to knowledge entries, and reference known details
6. If you discover new people, organizations, jargon, or reusable facts, save them as knowledge entries using save_knowledge
7. For uncertain knowledge links, use ⚠️ before the wikilink (e.g., ⚠️[[Knowledge/People/Dr. Chen|my shrink]]) and add a triage item using add_triage_item
8. Write a journal entry to Resources/Knowledge/Journal/ documenting your decisions
9. Commit changes to the vault

## Knowledge Links
- Confirmed links: \`[[Knowledge/People/Sarah|Sarah]]\`
- Uncertain links: \`⚠️[[Knowledge/People/Dr. Chen|my shrink]]\`
- The ⚠️ prefix means "pending user review" — make the link anyway so it's useful immediately

## Obsidian Tasks Format
Create tasks using this emoji format:
- \`- [ ] Task description ⏫ 📅 2024-01-15 ➕ 2024-01-08\`
- Priority emojis: 🔺 (highest), ⏫ (high), 🔼 (medium), 🔽 (low), ⏬ (lowest)
- Date emojis: 📅 (due), 🛫 (start), ⏳ (scheduled), ➕ (created), ✅ (done)

## Guidelines
- Use Obsidian-compatible markdown (wikilinks like [[Note Name]] are fine)
- Add YAML frontmatter to new notes (title, created date, tags)
- Keep notes concise but complete
- When unsure where something belongs, put it in the Inbox
- Always include a created date (➕) on tasks
- Prefer creating notes in existing projects/areas when relevant
`;

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
