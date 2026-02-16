import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "./log.js";

const exec = promisify(execFile);
const log = createLogger("qmd");

/** Result from a QMD search call */
export interface QmdSearchResult {
  path: string;
  score: number;
  snippet?: string;
  title?: string;
}

/**
 * Wraps the QMD CLI for vault search operations.
 * QMD provides BM25 full-text search, vector semantic search, and LLM re-ranking.
 */
export class QmdSearch {
  private available: boolean | null = null;

  constructor(private vaultPath: string) {}

  /** Check if qmd is installed and on PATH */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      await exec("qmd", ["status"], { timeout: 5000 });
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  /**
   * Set up QMD collections for the vault.
   * Creates three collections: knowledge, notes, sessions.
   */
  async setup(): Promise<void> {
    const collections = [
      {
        name: "knowledge",
        path: `${this.vaultPath}/Resources/Knowledge`,
        context: "Atomic knowledge entries: people, organizations, terms, and facts with aliases for recognition",
      },
      {
        name: "notes",
        path: this.vaultPath,
        context: "User's working notes: active projects, areas of responsibility, and reference resources",
      },
      {
        name: "sessions",
        path: `${this.vaultPath}/Resources/Session Logs`,
        context: "Past conversation transcripts and session logs",
      },
    ];

    for (const col of collections) {
      try {
        // Remove existing collection if present (idempotent setup)
        await exec("qmd", ["collection", "remove", col.name], { timeout: 10000 }).catch(() => {});
        await exec("qmd", ["collection", "add", col.path, "--name", col.name], { timeout: 10000 });
        await exec("qmd", ["context", "add", `qmd://${col.name}`, col.context], { timeout: 10000 });
      } catch (err) {
        log.error(`Failed to set up collection "${col.name}":`, err);
      }
    }

    // Exclude Session Logs and Knowledge from the "notes" collection
    // by using QMD's ignore patterns if available, or we rely on the
    // separate collections for targeted searches
  }

  /**
   * BM25 keyword search across specified collections.
   * Fast and suitable for hook-based auto-retrieval.
   */
  async search(
    query: string,
    collections?: string[],
    maxResults = 10,
  ): Promise<QmdSearchResult[]> {
    if (!(await this.isAvailable())) return [];

    try {
      // Multiple collections: run separate searches and merge
      if (collections && collections.length > 1) {
        const allResults: QmdSearchResult[] = [];
        for (const col of collections) {
          const args = ["search", query, "--json", "-n", String(maxResults), "-c", col];
          try {
            const { stdout } = await exec("qmd", args, { timeout: 15000 });
            allResults.push(...this.parseResults(stdout));
          } catch {
            // Skip failed collection
          }
        }
        return allResults
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults);
      }

      // Single collection or all
      const args = ["search", query, "--json", "-n", String(maxResults)];
      if (collections && collections.length === 1) {
        args.push("-c", collections[0]);
      }
      const { stdout } = await exec("qmd", args, { timeout: 15000 });
      return this.parseResults(stdout);
    } catch {
      return [];
    }
  }

  /**
   * Hybrid search with query expansion and LLM re-ranking.
   * Higher quality but slower — use for explicit agent searches.
   */
  async deepSearch(
    query: string,
    collections?: string[],
    maxResults = 10,
  ): Promise<QmdSearchResult[]> {
    if (!(await this.isAvailable())) return [];

    // Deep search across specific collections or all
    if (collections && collections.length >= 1) {
      const allResults: QmdSearchResult[] = [];
      for (const col of collections) {
        const args = ["query", query, "--json", "-n", String(maxResults), "-c", col];
        try {
          const { stdout } = await exec("qmd", args, { timeout: 60000 });
          allResults.push(...this.parseResults(stdout));
        } catch {
          // Skip failed collection
        }
      }
      return allResults
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
    }

    const args = ["query", query, "--json", "-n", String(maxResults)];
    try {
      const { stdout } = await exec("qmd", args, { timeout: 60000 });
      return this.parseResults(stdout);
    } catch {
      return [];
    }
  }

  /**
   * Retrieve a document's full content by path.
   */
  async get(docPath: string): Promise<string | null> {
    if (!(await this.isAvailable())) return null;

    try {
      const { stdout } = await exec("qmd", ["get", docPath, "--full"], { timeout: 10000 });
      return stdout;
    } catch {
      return null;
    }
  }

  /**
   * Re-index vault content (generate embeddings).
   * Runs in background — does not block.
   */
  reindex(): void {
    if (this.available === false) return;

    const child = spawn("qmd", ["embed"], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
  }

  /** Parse QMD JSON output into structured results */
  private parseResults(stdout: string): QmdSearchResult[] {
    try {
      const parsed = JSON.parse(stdout);
      const items = Array.isArray(parsed) ? parsed : parsed.results ?? [];
      return items.map((item: any) => ({
        path: item.path ?? item.file ?? "",
        score: item.score ?? item.rank ?? 0,
        snippet: item.snippet ?? item.content ?? item.excerpt ?? undefined,
        title: item.title ?? undefined,
      }));
    } catch {
      return [];
    }
  }
}

/** Scope for the unified search_vault tool */
export type SearchScope = "all" | "knowledge" | "notes" | "sessions" | "deep";

/** Map scopes to QMD collections */
export function scopeToCollections(scope: SearchScope): string[] | undefined {
  switch (scope) {
    case "knowledge":
      return ["knowledge"];
    case "notes":
      return ["notes"];
    case "sessions":
      return ["sessions"];
    case "all":
      return ["knowledge", "notes"];
    case "deep":
      return ["knowledge", "notes"];
  }
}
