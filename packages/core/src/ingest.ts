import { OctopalAgent } from "./agent.js";
import type { SessionEventHandler } from "@github/copilot-sdk";
import type { OctopalConfig, IngestResult } from "./types.js";

export class IngestPipeline {
  private agent: OctopalAgent;

  constructor(config: OctopalConfig) {
    this.agent = new OctopalAgent(config);
  }

  /** Ingest raw text — the agent decides where to file it and what tasks to create */
  async ingest(rawText: string, options?: { onEvent?: SessionEventHandler }): Promise<IngestResult> {
    await this.agent.init();

    try {
      const prompt = `I have some raw notes/thoughts to process. Please:
1. Read the current vault structure to understand what projects/areas already exist
2. Analyze the following content and decide where it belongs in the PARA system
3. Create or update the appropriate notes
4. Extract any actionable items and create tasks
5. Commit the changes with a descriptive message

Here's the content to process:

---
${rawText}
---`;

      const response = await this.agent.run(prompt, options);

      // Auto-commit fallback: if the agent didn't commit, do it now
      if (await this.agent.vault.hasUncommittedChanges()) {
        await this.agent.vault.commitAndPush("octopal: auto-commit ingested changes");
      }

      return {
        notes: [],
        tasks: [],
        summary: response,
      };
    } finally {
      await this.agent.stop();
    }
  }
}
