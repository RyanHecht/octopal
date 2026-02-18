import type { VaultManager } from "./vault.js";
import { createLogger } from "./log.js";

const log = createLogger("knowledge");

const KNOWLEDGE_DIR = "Resources/Knowledge";
const KNOWLEDGE_CATEGORIES = ["People", "Terms", "Organizations"] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeEntry {
  /** Relative path in vault, e.g. "Resources/Knowledge/People/dr-chen.md" */
  path: string;
  title: string;
  aliases: string[];
  category: string;
}

export interface AliasLookup {
  entries: KnowledgeEntry[];
  /** Normalized title/alias → entry path(s) */
  lookup: Map<string, string[]>;
}

/** For backward compatibility — same shape as AliasLookup */
export type KnowledgeIndex = AliasLookup;

/**
 * Normalize a string for matching: strip periods within words, collapse whitespace, lowercase.
 * Preserves hyphens to avoid false positives (e.g., "re-act" ≠ "react").
 */
export function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/\./g, "")         // strip all periods ("Dr." → "Dr", "U.S.A." → "USA", "node.js" → "nodejs")
    .replace(/\s+/g, " ")      // collapse whitespace
    .trim();
}

/** Quote an alias for safe insertion into YAML inline arrays */
export function quoteAlias(alias: string): string {
  if (/[,:\[\]'"#{}|>&*!?@`]/.test(alias)) {
    return `"${alias.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return alias;
}

/**
 * Add an alias to a knowledge entry's frontmatter.
 * Returns true if the file was modified.
 */
export async function addAliasToEntry(
  vault: VaultManager,
  knowledgePath: string,
  alias: string,
): Promise<boolean> {
  try {
    const content = await vault.readFile(knowledgePath);
    const aliasMatch = content.match(/^aliases:\s*\[([^\]]*)\]/m);
    const quoted = quoteAlias(alias);
    if (aliasMatch) {
      const existing = aliasMatch[1];
      // Check if alias already exists (unquoted comparison)
      const existingAliases = existing.split(",").map((a) => a.trim().replace(/^"|"$/g, ""));
      if (existingAliases.some((a) => a.toLowerCase() === alias.toLowerCase())) {
        return false; // Already exists
      }
      const newAliases = existing ? `${existing}, ${quoted}` : quoted;
      const updated = content.replace(aliasMatch[0], `aliases: [${newAliases}]`);
      await vault.writeFile(knowledgePath, updated);
    } else {
      // No aliases line — add one after title
      const updated = content.replace(/^(title:.*\n)/m, `$1aliases: [${quoted}]\n`);
      if (updated === content) {
        log.warn(`Cannot add alias to ${knowledgePath}: no title line found`);
        return false;
      }
      await vault.writeFile(knowledgePath, updated);
    }
    return true;
  } catch (e) {
    log.warn(`Failed to add alias "${alias}" to ${knowledgePath}`, e);
    return false;
  }
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

/** Scan Resources/Knowledge/ and build a lightweight alias lookup (no vault walk) */
export async function buildAliasLookup(
  vault: VaultManager,
): Promise<AliasLookup> {
  const entries: KnowledgeEntry[] = [];
  const lookup = new Map<string, string[]>();

  for (const category of KNOWLEDGE_CATEGORIES) {
    const dirPath = `${KNOWLEDGE_DIR}/${category}`;
    let files: string[];
    try {
      files = await vault.listDir(dirPath);
    } catch (e) {
      log.warn(`Failed to list ${dirPath}`, e);
      continue;
    }

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
        };

        entries.push(entry);

        // Index by normalized title and aliases
        const keys = [title, ...aliases];
        for (const key of keys) {
          const norm = normalize(key);
          const existing = lookup.get(norm) || [];
          existing.push(filePath);
          lookup.set(norm, existing);
        }
      } catch (e) {
        log.warn(`Failed to read knowledge entry ${filePath}`, e);
      }
    }
  }

  return { entries, lookup };
}

/** @deprecated Use buildAliasLookup instead */
export const buildKnowledgeIndex = buildAliasLookup;

// --- Cached alias lookup ---

let _cachedLookup: AliasLookup | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL = 30_000;

/** Get a cached alias lookup, rebuilding if stale or invalidated */
export async function getCachedAliasLookup(vault: VaultManager): Promise<AliasLookup> {
  if (_cachedLookup && Date.now() - _cacheTimestamp < CACHE_TTL) {
    return _cachedLookup;
  }
  _cachedLookup = await buildAliasLookup(vault);
  _cacheTimestamp = Date.now();
  return _cachedLookup;
}

/** Invalidate the alias lookup cache (call after writes to knowledge entries) */
export function invalidateAliasCache(): void {
  _cachedLookup = null;
  _cacheTimestamp = 0;
}

/** Phase 1: Deterministic normalized string matching */
export function deterministicMatch(
  index: AliasLookup,
  input: string,
): Set<string> {
  const matched = new Set<string>();
  const normalizedInput = normalize(input);

  for (const [key, paths] of index.lookup) {
    if (normalizedInput.includes(key)) {
      for (const p of paths) {
        matched.add(p);
      }
    }
  }

  return matched;
}

/** Format a compact entry roster for the Haiku preprocessor (title + aliases + category, no content/backlinks) */
export function formatEntryRoster(index: AliasLookup): string {
  if (index.entries.length === 0) return "(no knowledge entries yet)";

  const lines: string[] = [];
  for (const entry of index.entries) {
    let line = `- **${entry.title}** [${entry.category}] (${entry.path})`;
    if (entry.aliases.length > 0) {
      line += ` — aliases: ${entry.aliases.join(", ")}`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/** Format a compact name list for system prompt injection (~2k tokens for 1000 entries) */
export function formatEntityNameList(index: AliasLookup): string {
  if (index.entries.length === 0) return "";

  const items: string[] = [];
  for (const entry of index.entries) {
    let item = `${entry.title} [${entry.category}]`;
    if (entry.aliases.length > 0) {
      item += ` (aka: ${entry.aliases.join(", ")})`;
    }
    items.push(item);
  }
  return items.join("\n");
}

/** @deprecated Use formatEntryRoster instead */
export const formatIndexForLLM = formatEntryRoster;

/** Slugify a name for use as a filename */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export { KNOWLEDGE_DIR, KNOWLEDGE_CATEGORIES };
