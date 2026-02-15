import type { VaultManager } from "./vault.js";

/**
 * Transform [[wikilinks]] in text to clickable markdown links.
 * Acts as a safety net: catches wikilinks the agent didn't convert,
 * and handles wikilinks in tool-generated content.
 *
 * @param text - Text potentially containing [[wikilinks]]
 * @param baseUrl - Base URL for the vault viewer (e.g., "https://vault.example.com")
 * @param fileIndex - Set of known vault file paths for resolution
 * @returns Text with wikilinks replaced by markdown links
 */
export function transformWikilinks(
  text: string,
  baseUrl: string,
  fileIndex?: Set<string>,
  vaultPathPrefix?: string,
): string {
  // Match [[target]] or [[target|display]]
  return text.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, display?: string) => {
      const label = display ?? target;
      const resolved = resolveNotePath(target.trim(), fileIndex);
      const url = buildVaultFileUrl(baseUrl, resolved, vaultPathPrefix);
      return `[${label}](${url})`;
    },
  );
}

/**
 * Build a URL that opens a vault file in the web viewer (code-server).
 * Encodes each path segment individually so `/` separators are preserved.
 */
export function buildVaultFileUrl(
  baseUrl: string,
  filePath: string,
  vaultPathPrefix?: string,
): string {
  const prefix = vaultPathPrefix ? `${vaultPathPrefix.replace(/\/+$/, "")}/` : "";
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/?file=${prefix}${encoded}`;
}

/**
 * Resolve a wikilink target to a vault file path.
 * Handles case-insensitive matching and omitted .md extension.
 */
function resolveNotePath(target: string, fileIndex?: Set<string>): string {
  if (!fileIndex || fileIndex.size === 0) {
    // No index available — assume target is a path, add .md if needed
    return target.endsWith(".md") ? target : `${target}.md`;
  }

  // Exact match
  if (fileIndex.has(target)) return target;
  if (fileIndex.has(`${target}.md`)) return `${target}.md`;

  // Case-insensitive match
  const targetLower = target.toLowerCase();
  for (const filePath of fileIndex) {
    const fileName = filePath.split("/").pop() ?? "";
    const fileNameNoExt = fileName.replace(/\.md$/, "");
    if (fileNameNoExt.toLowerCase() === targetLower) {
      return filePath;
    }
  }

  // Fallback: assume it's a path in Resources/Knowledge/
  return target.endsWith(".md")
    ? `Resources/Knowledge/${target}`
    : `Resources/Knowledge/${target}.md`;
}

/**
 * Build a file index from the vault for wikilink resolution.
 */
export async function buildFileIndex(vault: VaultManager): Promise<Set<string>> {
  const index = new Set<string>();
  await walkDir(vault, "", index);
  return index;
}

async function walkDir(vault: VaultManager, dir: string, index: Set<string>): Promise<void> {
  try {
    const entries = await vault.listDir(dir);
    for (const entry of entries) {
      const fullPath = dir ? `${dir}/${entry}` : entry;
      if (entry.endsWith(".md")) {
        index.add(fullPath);
      } else if (!entry.startsWith(".") && !entry.includes(".")) {
        // Likely a directory — recurse
        await walkDir(vault, fullPath, index);
      }
    }
  } catch {
    // Directory doesn't exist or read error — skip
  }
}
