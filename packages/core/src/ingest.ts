import { OctopalAgent } from "./agent.js";
import { runPreprocessor } from "./preprocessor.js";
import type { PreprocessorResult } from "./preprocessor.js";
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
      // Run two-phase preprocessor: deterministic + semantic matching
      const preprocessed = await runPreprocessor(
        this.agent.client,
        this.agent.vault,
        rawText,
      );

      // Auto-apply high-confidence new aliases
      await this.applyNewAliases(preprocessed);

      // Build the enriched prompt
      const prompt = this.buildPrompt(rawText, preprocessed);

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

  private buildPrompt(rawText: string, preprocessed: PreprocessorResult): string {
    const sections: string[] = [];

    sections.push(`I have some raw notes/thoughts to process. Please:
1. Read the current vault structure to understand what projects/areas already exist
2. Analyze the following content and decide where it belongs in the PARA system
3. Create or update the appropriate notes, using wikilinks to knowledge entries where relevant
4. Extract any actionable items and create tasks
5. Save any newly discovered people, organizations, or terms as knowledge entries using save_knowledge
6. For uncertain associations, use ⚠️ before the wikilink and add a triage item using add_triage_item
7. Write a journal entry to Resources/Knowledge/Journal/ documenting what you did and why
8. Commit the changes with a descriptive message`);

    // Add matched knowledge context
    if (preprocessed.matched.length > 0) {
      sections.push(`\n## Relevant Knowledge Context\nThe following knowledge entries are relevant to this input:\n`);
      for (const entry of preprocessed.matched) {
        sections.push(`### ${entry.path}\n\`\`\`\n${entry.content}\n\`\`\``);
      }
    }

    // Add triage hints from preprocessor
    if (preprocessed.triageItems.length > 0) {
      sections.push(`\n## Uncertain Associations (use ⚠️ links + add_triage_item)\nThe preprocessor found these possible but uncertain matches:`);
      for (const item of preprocessed.triageItems) {
        sections.push(`- "${item.text}" might refer to ${item.suggestedMatch ?? "unknown"} (${item.reasoning})`);
      }
    }

    // Add new entity hints
    if (preprocessed.newEntities.length > 0) {
      sections.push(`\n## New Entities to Save\nThese appear to be new people, organizations, or terms not yet in the knowledge base. Use save_knowledge to create entries for them:`);
      for (const entity of preprocessed.newEntities) {
        sections.push(`- **${entity.name}** (${entity.categoryHint}): "${entity.context}"`);
      }
    }

    sections.push(`\nHere's the content to process:\n\n---\n${rawText}\n---`);

    return sections.join("\n");
  }

  /** Apply high-confidence new aliases to knowledge entries */
  private async applyNewAliases(preprocessed: PreprocessorResult): Promise<void> {
    for (const { knowledgePath, alias } of preprocessed.newAliases) {
      try {
        const content = await this.agent.vault.readFile(knowledgePath);
        const aliasMatch = content.match(/^aliases:\s*\[([^\]]*)\]/m);
        if (aliasMatch) {
          // Add to existing aliases array
          const existing = aliasMatch[1];
          const newAliases = existing ? `${existing}, ${alias}` : alias;
          const updated = content.replace(aliasMatch[0], `aliases: [${newAliases}]`);
          await this.agent.vault.writeFile(knowledgePath, updated);
        } else {
          // No aliases field — add one after the title
          const updated = content.replace(
            /^(title:.*\n)/m,
            `$1aliases: [${alias}]\n`,
          );
          await this.agent.vault.writeFile(knowledgePath, updated);
        }
      } catch {
        // Skip if file can't be read/written
      }
    }
  }
}
