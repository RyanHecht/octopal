import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { VaultManager } from "./vault.js";

const KNOWLEDGE_DIR = "Resources/Knowledge";
const KNOWLEDGE_CATEGORIES = ["People", "Terms", "Organizations"] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeEntry {
  /** Relative path in vault, e.g. "Resources/Knowledge/People/dr-chen.md" */
  path: string;
  title: string;
  aliases: string[];
  category: string;
  /** Notes that link to this entry + surrounding context */
  backlinks: { notePath: string; snippet: string }[];
}

export interface KnowledgeIndex {
  entries: KnowledgeEntry[];
  /** Lowercased title/alias → entry path(s) */
  lookup: Map<string, string[]>;
}

/** Parse YAML frontmatter from a markdown string */
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, unknown> = {};

  for (const line of yaml.split("\n")) {
    const kvMatch = line.match(/^(\w+):\s*(.+)$/);
    if (!kvMatch) continue;

    const [, key, rawValue] = kvMatch;
    let value: unknown = rawValue.trim();

    // Parse inline YAML arrays: [a, b, c]
    const arrayMatch = (value as string).match(/^\[(.*)\]$/);
    if (arrayMatch) {
      value = arrayMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
    }

    result[key] = value;
  }

  return result;
}

/** Scan Resources/Knowledge/ and build an index of all entries */
export async function buildKnowledgeIndex(
  vault: VaultManager,
): Promise<KnowledgeIndex> {
  const entries: KnowledgeEntry[] = [];
  const lookup = new Map<string, string[]>();

  // Scan knowledge entries
  for (const category of KNOWLEDGE_CATEGORIES) {
    const dirPath = `${KNOWLEDGE_DIR}/${category}`;
    const files = await vault.listDir(dirPath);

    for (const file of files) {
      if (!file.endsWith(".md") || file === "README.md") continue;

      const filePath = `${dirPath}/${file}`;
      try {
        const content = await vault.readFile(filePath);
        const fm = parseFrontmatter(content);

        const title = (fm.title as string) || file.replace(/\.md$/, "");
        const aliases = Array.isArray(fm.aliases)
          ? (fm.aliases as string[])
          : [];

        const entry: KnowledgeEntry = {
          path: filePath,
          title,
          aliases,
          category: category.toLowerCase(),
          backlinks: [],
        };

        entries.push(entry);

        // Index by title and aliases
        const keys = [title, ...aliases];
        for (const key of keys) {
          const lower = key.toLowerCase();
          const existing = lookup.get(lower) || [];
          existing.push(filePath);
          lookup.set(lower, existing);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  // Collect backlinks from all vault notes
  if (entries.length > 0) {
    await collectBacklinks(vault, entries);
  }

  return { entries, lookup };
}

/** Scan all vault .md files for wikilinks to knowledge entries */
async function collectBacklinks(
  vault: VaultManager,
  entries: KnowledgeEntry[],
): Promise<void> {
  // Build a map of possible link targets → entry
  const linkTargetMap = new Map<string, KnowledgeEntry>();
  for (const entry of entries) {
    // Match on full path, path without extension, and filename without extension
    const withoutExt = entry.path.replace(/\.md$/, "");
    const basename = path.basename(entry.path, ".md");
    linkTargetMap.set(entry.path.toLowerCase(), entry);
    linkTargetMap.set(withoutExt.toLowerCase(), entry);
    linkTargetMap.set(basename.toLowerCase(), entry);
    // Also match on title
    linkTargetMap.set(entry.title.toLowerCase(), entry);
  }

  // Wikilink pattern: [[target]] or [[target|display]]
  const wikilinkRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

  await walkForBacklinks(vault, "", wikilinkRe, linkTargetMap);
}

async function walkForBacklinks(
  vault: VaultManager,
  dirPath: string,
  wikilinkRe: RegExp,
  linkTargetMap: Map<string, KnowledgeEntry>,
): Promise<void> {
  const items = await vault.listDir(dirPath || ".");

  for (const item of items) {
    const itemPath = dirPath ? `${dirPath}/${item}` : item;

    if (item.endsWith("/")) {
      // Directory — recurse (but skip Journal to avoid self-references)
      const dirName = item.slice(0, -1);
      if (itemPath === `${KNOWLEDGE_DIR}/Journal`) continue;
      await walkForBacklinks(
        vault,
        dirPath ? `${dirPath}/${dirName}` : dirName,
        wikilinkRe,
        linkTargetMap,
      );
    } else if (item.endsWith(".md") && item !== "README.md") {
      // Skip knowledge entries themselves
      const fullPath = dirPath ? `${dirPath}/${item}` : item;
      if (fullPath.startsWith(KNOWLEDGE_DIR)) continue;

      try {
        const content = await vault.readFile(fullPath);
        const lines = content.split("\n");

        for (const line of lines) {
          let match: RegExpExecArray | null;
          wikilinkRe.lastIndex = 0;
          while ((match = wikilinkRe.exec(line)) !== null) {
            const target = match[1].trim().toLowerCase();
            const entry = linkTargetMap.get(target);
            if (entry) {
              entry.backlinks.push({
                notePath: fullPath,
                snippet: line.trim(),
              });
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
}

/** Phase 1: Deterministic case-insensitive string matching */
export function deterministicMatch(
  index: KnowledgeIndex,
  input: string,
): Set<string> {
  const matched = new Set<string>();
  const lowerInput = input.toLowerCase();

  for (const [key, paths] of index.lookup) {
    if (lowerInput.includes(key)) {
      for (const p of paths) {
        matched.add(p);
      }
    }
  }

  return matched;
}

/** Format the knowledge index for the semantic preprocessor prompt */
export function formatIndexForLLM(index: KnowledgeIndex): string {
  if (index.entries.length === 0) return "(no knowledge entries yet)";

  const lines: string[] = [];
  for (const entry of index.entries) {
    let line = `- **${entry.title}** [${entry.category}] (${entry.path})`;
    if (entry.aliases.length > 0) {
      line += ` — aliases: ${entry.aliases.join(", ")}`;
    }
    if (entry.backlinks.length > 0) {
      const uniqueNotes = [...new Set(entry.backlinks.map((b) => b.notePath))];
      line += ` — referenced in: ${uniqueNotes.slice(0, 5).join(", ")}`;
      // Include a few backlink snippets for semantic context
      const snippets = entry.backlinks
        .slice(0, 3)
        .map((b) => b.snippet)
        .join("; ");
      if (snippets) {
        line += ` — context: "${snippets}"`;
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/** Slugify a name for use as a filename */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export { KNOWLEDGE_DIR, KNOWLEDGE_CATEGORIES };
