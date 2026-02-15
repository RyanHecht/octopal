---
name: wiki-updater
description: >
  Analyze code changes in the Octopal repository and update the GitHub wiki
  to reflect those changes. Supports uncommitted changes, specific commits,
  PRs, and ranges of commits.
metadata:
  author: octopal
  version: "0.1"
---

# Wiki Updater

You update the Octopal GitHub wiki based on code changes. The wiki lives in the `wiki/` directory at the repository root (a separate git clone of the GitHub wiki repo).

## When This Skill Activates

Use this skill when the user asks you to update the wiki, sync documentation, or review whether the wiki needs updates based on code changes.

## Wiki Pages

The wiki consists of these pages (all in `wiki/`):

| File | Content |
|------|---------|
| `Home.md` | Landing page with overview and navigation links |
| `Getting-Started.md` | Prerequisites, installation, first-time setup |
| `CLI-Reference.md` | All CLI commands, options, and examples |
| `Architecture.md` | Package overview, module guide, data flow, dependencies |
| `Configuration.md` | config.toml options, env vars, file locations |
| `Skills-System.md` | Three-tier resolution, SKILL.md format, creating skills |
| `PARA-Method.md` | Vault structure, ingestion workflow, task format |
| `Agent-Tools.md` | All agent tools with parameters and descriptions |
| `Daemon-and-API.md` | REST endpoints, WebSocket protocol, session management |
| `Connectors.md` | Discord, remote connectors, building custom connectors |
| `Knowledge-Base.md` | Knowledge entries, preprocessor, triage system |
| `Scheduler.md` | Scheduled tasks, TOML format, cron syntax |
| `Contributing.md` | Dev setup, building, adding tools/connectors/skills |
| `_Sidebar.md` | Navigation sidebar |

## How to Analyze Changes

Depending on what the user asks, use these approaches:

### Uncommitted Changes

```bash
git diff                    # Unstaged changes
git diff --cached           # Staged changes
git diff HEAD               # All uncommitted changes (staged + unstaged)
```

### Specific Commit

```bash
git show <commit-sha>       # Full diff of a single commit
git log --oneline -1 <sha>  # Commit message
```

### Pull Request / Branch Diff

```bash
git diff main...<branch>    # Changes introduced by a branch
git log --oneline main...<branch>  # Commits in the branch
```

### Changes Since a Commit

```bash
git diff <commit-sha>..HEAD           # Diff from commit to current HEAD
git log --oneline <commit-sha>..HEAD  # All commits since that point
```

### Recent Changes (by time)

```bash
git log --oneline --since="1 week ago"
git diff HEAD~10..HEAD      # Last 10 commits
```

## Workflow

1. **Gather the diff** — Use the appropriate git command based on the user's request
2. **Identify affected wiki pages** — Map changed files to relevant wiki pages:

   | Changed files | Wiki pages to check |
   |--------------|---------------------|
   | `packages/core/src/tools.ts` | Agent-Tools.md |
   | `packages/core/src/agent.ts` | Architecture.md |
   | `packages/core/src/vault.ts` | Architecture.md |
   | `packages/core/src/para.ts` | PARA-Method.md, Architecture.md |
   | `packages/core/src/tasks.ts` | PARA-Method.md |
   | `packages/core/src/config.ts` | Configuration.md |
   | `packages/core/src/auth.ts` | Daemon-and-API.md |
   | `packages/core/src/preprocessor.ts` | Knowledge-Base.md |
   | `packages/core/src/knowledge.ts` | Knowledge-Base.md |
   | `packages/core/src/scheduler.ts` | Scheduler.md |
   | `packages/core/src/schedule-types.ts` | Scheduler.md |
   | `packages/core/src/prompts.ts` | Architecture.md |
   | `packages/core/src/connector.ts` | Connectors.md |
   | `packages/cli/src/index.ts` | CLI-Reference.md, Getting-Started.md |
   | `packages/cli/src/setup.ts` | Getting-Started.md |
   | `packages/cli/src/skills.ts` | Skills-System.md, CLI-Reference.md |
   | `packages/cli/src/client.ts` | Architecture.md |
   | `packages/server/src/server.ts` | Daemon-and-API.md, Architecture.md |
   | `packages/server/src/protocol.ts` | Daemon-and-API.md |
   | `packages/server/src/ws.ts` | Daemon-and-API.md |
   | `packages/server/src/sessions.ts` | Daemon-and-API.md |
   | `packages/server/src/routes/*.ts` | Daemon-and-API.md |
   | `packages/connector-discord/**` | Connectors.md |
   | `packages/connector/**` | Connectors.md |
   | `skills/**` | Skills-System.md |
   | `package.json` | Getting-Started.md, Architecture.md |
   | `ARCHITECTURE.md` | _(pointer file — no content to sync)_ |
   | `README.md` | Home.md, Getting-Started.md |

3. **Read the current wiki page** — Read the relevant wiki page(s)
4. **Read the changed source files** — Understand the new behavior
5. **Update the wiki** — Make surgical edits to reflect the changes:
   - Add documentation for new tools, commands, config options, or features
   - Update changed parameters, behaviors, or defaults
   - Remove documentation for deleted features
   - Keep the existing style and structure
6. **Commit and push the wiki** — From the `wiki/` directory:
   ```bash
   cd wiki && git add -A && git commit -m "Update wiki: <summary>" && git push
   ```

## Guidelines

- **Be surgical** — Only update sections that are actually affected by the changes
- **Preserve style** — Match the existing formatting, table structure, and heading hierarchy
- **Don't over-document** — Internal implementation details don't need wiki coverage; focus on user-facing behavior and developer-facing APIs
- **Update the sidebar** — If you add a new page, add it to `_Sidebar.md`
- **Update Home.md** — If you add a new page, add it to the quick links table
- **Check cross-references** — If you rename or restructure a page, update `[[links]]` in other pages
