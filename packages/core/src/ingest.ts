import { OctopalAgent } from "./agent.js";
import type { OctopalConfig, IngestResult } from "./types.js";

export class IngestPipeline {
  private agent: OctopalAgent;

  constructor(config: OctopalConfig) {
    this.agent = new OctopalAgent(config);
  }

  /** Ingest raw text — the agent decides where to file it and what tasks to create */
  async ingest(rawText: string): Promise<IngestResult> {
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

      const response = await this.agent.run(prompt);

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
