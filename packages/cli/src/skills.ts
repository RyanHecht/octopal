import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ResolvedConfig } from "@octopal/core";

interface SkillInfo {
  name: string;
  description: string;
  source: "bundled" | "vault" | "local";
  path: string;
}

async function discoverSkills(dir: string, source: SkillInfo["source"]): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(dir, entry.name, "SKILL.md");
      try {
        const content = await fs.readFile(skillMd, "utf-8");
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        const descMatch = content.match(/^description:\s*>?\s*\n?\s*(.+)$/m);
        skills.push({
          name: nameMatch?.[1]?.trim() ?? entry.name,
          description: descMatch?.[1]?.trim() ?? "(no description)",
          source,
          path: path.join(dir, entry.name),
        });
      } catch {
        // No SKILL.md — skip
      }
    }
  } catch {
    // Directory doesn't exist — skip
  }
  return skills;
}

export async function listSkills(config: ResolvedConfig): Promise<void> {
  const bundledDir = path.resolve(
    new URL(".", import.meta.url).pathname,
    "../../..",
    "skills",
  );
  const vaultDir = path.join(config.vaultPath, "Meta/skills");
  const localDir = path.join(config.configDir, "skills");

  const [bundled, vault, local] = await Promise.all([
    discoverSkills(bundledDir, "bundled"),
    discoverSkills(vaultDir, "vault"),
    discoverSkills(localDir, "local"),
  ]);

  const all = [...bundled, ...vault, ...local];

  if (all.length === 0) {
    console.log("No skills found.");
    return;
  }

  console.log("Skills:\n");
  for (const skill of all) {
    const tag = `[${skill.source}]`;
    console.log(`  ${skill.name.padEnd(20)} ${tag.padEnd(10)} ${skill.description}`);
  }
  console.log(`\n${all.length} skill(s) found.`);
}

export async function createSkill(config: ResolvedConfig, name: string): Promise<void> {
  const skillDir = path.join(config.configDir, "skills", name);

  try {
    await fs.access(skillDir);
    console.error(`Error: Skill directory already exists: ${skillDir}`);
    process.exit(1);
  } catch {
    // Directory doesn't exist — good
  }

  await fs.mkdir(skillDir, { recursive: true });

  const skillMd = `---
name: ${name}
description: >
  TODO: Describe what this skill does.
metadata:
  author: user
  version: "0.1"
---

# ${name}

Add your skill instructions here. These will be injected into the agent's
system prompt when this skill is active.
`;

  await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd);
  console.log(`✓ Created skill at ${skillDir}`);
  console.log(`  Edit ${path.join(skillDir, "SKILL.md")} to customize.`);
}
