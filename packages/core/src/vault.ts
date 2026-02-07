import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { VaultConfig } from "./types.js";

const exec = promisify(execFile);

export class VaultManager {
  constructor(private config: VaultConfig) {}

  get root(): string {
    return this.config.localPath;
  }

  /** Ensure the vault exists locally — clone if needed, pull if it does */
  async init(): Promise<void> {
    try {
      await fs.access(path.join(this.config.localPath, ".git"));
      await this.pull();
    } catch {
      if (this.config.remoteUrl) {
        // Use gh CLI for cloning — it handles auth automatically
        await fs.mkdir(path.dirname(this.config.localPath), { recursive: true });
        await exec("gh", ["repo", "clone", this.config.remoteUrl, this.config.localPath]);
      } else {
        await fs.mkdir(this.config.localPath, { recursive: true });
        await this.git("init");
      }
    }
  }

  async pull(): Promise<void> {
    try {
      await this.git("pull", "--rebase", "--autostash");
    } catch {
      // No remote configured or offline — that's fine
    }
  }

  async commitAndPush(message: string): Promise<void> {
    await this.git("add", "-A");
    const { stdout } = await this.git("status", "--porcelain");
    if (!stdout.trim()) return; // nothing to commit

    await this.git("commit", "-m", message);
    try {
      await this.git("push");
    } catch {
      // No remote or offline — commit is saved locally
    }
  }

  async readFile(relativePath: string): Promise<string> {
    return fs.readFile(path.join(this.config.localPath, relativePath), "utf-8");
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.config.localPath, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.config.localPath, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async listDir(relativePath: string): Promise<string[]> {
    const fullPath = path.join(this.config.localPath, relativePath);
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return entries
        .filter((e) => !e.name.startsWith("."))
        .map((e) => (e.isDirectory() ? e.name + "/" : e.name));
    } catch {
      return [];
    }
  }

  async search(query: string): Promise<{ path: string; line: string }[]> {
    const results: { path: string; line: string }[] = [];
    const lowerQuery = query.toLowerCase();
    await this.walkAndSearch(this.config.localPath, lowerQuery, results);
    return results;
  }

  async appendToFile(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.config.localPath, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    try {
      const existing = await fs.readFile(fullPath, "utf-8");
      await fs.writeFile(fullPath, existing + "\n" + content, "utf-8");
    } catch {
      await fs.writeFile(fullPath, content, "utf-8");
    }
  }

  async moveFile(from: string, to: string): Promise<void> {
    const fullFrom = path.join(this.config.localPath, from);
    const fullTo = path.join(this.config.localPath, to);
    await fs.mkdir(path.dirname(fullTo), { recursive: true });
    await fs.rename(fullFrom, fullTo);
  }

  private async git(...args: string[]) {
    return exec("git", ["-C", this.config.localPath, ...args]);
  }

  private async walkAndSearch(
    dir: string,
    query: string,
    results: { path: string; line: string }[],
  ): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walkAndSearch(fullPath, query, results);
      } else if (entry.name.endsWith(".md")) {
        const content = await fs.readFile(fullPath, "utf-8");
        for (const line of content.split("\n")) {
          if (line.toLowerCase().includes(query)) {
            results.push({
              path: path.relative(this.config.localPath, fullPath),
              line: line.trim(),
            });
          }
        }
      }
    }
  }
}
