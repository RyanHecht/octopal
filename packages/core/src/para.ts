import * as path from "node:path";
import { VaultManager } from "./vault.js";

export enum ParaCategory {
  Projects = "Projects",
  Areas = "Areas",
  Resources = "Resources",
  Archives = "Archives",
  Inbox = "Inbox",
}

const PARA_DIRS = Object.values(ParaCategory);

export class ParaManager {
  constructor(private vault: VaultManager) {}

  /** Ensure the PARA directory structure exists */
  async ensureStructure(): Promise<void> {
    for (const dir of PARA_DIRS) {
      const dirPath = path.join(dir);
      if (!(await this.vault.exists(dirPath))) {
        await this.vault.writeFile(path.join(dirPath, ".gitkeep"), "");
      }
    }
    if (!(await this.vault.exists("Templates"))) {
      await this.vault.writeFile("Templates/.gitkeep", "");
    }
  }

  /** List items (subfolders/files) in a PARA category */
  async listCategory(category: ParaCategory): Promise<string[]> {
    return this.vault.listDir(category);
  }

  /** Get the full vault structure as a tree string */
  async getStructure(): Promise<string> {
    const lines: string[] = [];
    for (const cat of PARA_DIRS) {
      lines.push(`${cat}/`);
      const items = await this.vault.listDir(cat);
      for (const item of items) {
        if (item === ".gitkeep") continue;
        lines.push(`  ${item}`);
      }
    }
    return lines.join("\n");
  }

  /** Create a new item (folder + index.md) in a PARA category */
  async createItem(
    category: ParaCategory,
    name: string,
    content: string,
  ): Promise<string> {
    const slug = this.slugify(name);
    const itemPath =
      category === ParaCategory.Inbox
        ? `${category}/${slug}.md`
        : `${category}/${slug}/index.md`;

    await this.vault.writeFile(itemPath, content);
    return itemPath;
  }

  /** Move an item between PARA categories */
  async moveItem(
    fromCategory: ParaCategory,
    toCategory: ParaCategory,
    itemName: string,
  ): Promise<void> {
    const from = `${fromCategory}/${itemName}`;
    const to = `${toCategory}/${itemName}`;
    await this.vault.moveFile(from, to);
  }

  /** Archive an item (move to Archives) */
  async archive(
    fromCategory: ParaCategory,
    itemName: string,
  ): Promise<void> {
    await this.moveItem(fromCategory, ParaCategory.Archives, itemName);
  }

  /** Create an inbox note with timestamped filename */
  async createInboxNote(title: string, content: string): Promise<string> {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const slug = this.slugify(title);
    const filename = `Inbox/${timestamp}-${slug}.md`;
    const frontmatter = `---\ntitle: "${title}"\ncreated: ${new Date().toISOString()}\n---\n\n`;
    await this.vault.writeFile(filename, frontmatter + content);
    return filename;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
}
