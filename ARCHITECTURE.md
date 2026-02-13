# Octopal — Architecture & Maintainer Guide

This document explains how octopal works, the patterns it uses, and how to extend it. It's written for someone who may not be deeply familiar with TypeScript or the Copilot SDK.

---

## Table of Contents

1. [TypeScript Crash Course](#typescript-crash-course)
2. [Project Layout](#project-layout)
3. [How the Build Works](#how-the-build-works)
4. [Module-by-Module Guide](#module-by-module-guide)
5. [The Copilot SDK](#the-copilot-sdk)
6. [Skills System](#skills-system)
7. [How to Add a New Agent Tool](#how-to-add-a-new-agent-tool)
8. [How to Build a New Connector](#how-to-build-a-new-connector)
9. [Discord Connector](#discord-connector)
10. [Common Tasks](#common-tasks)
11. [Troubleshooting](#troubleshooting)

---

## TypeScript Crash Course

If you're coming from Python or another language, here's what you need to know about the TypeScript patterns used in this project.

### Types and Interfaces

```typescript
// An interface defines the shape of an object
interface VaultConfig {
  localPath: string;        // required string field
  remoteUrl?: string;       // optional (the ? makes it optional)
}

// An enum defines a fixed set of values
enum ParaCategory {
  Projects = "Projects",
  Areas = "Areas",
}
```

### Imports/Exports

```typescript
// Named exports — each file exports specific things
export class VaultManager { ... }
export interface VaultConfig { ... }

// Named imports — you pick what you need
import { VaultManager } from "./vault.js";

// Re-exports — index.ts collects everything into one place
export { VaultManager } from "./vault.js";
```

**Important**: In ESM (ES Modules, which this project uses), you must include `.js` in import paths even though the source files are `.ts`. TypeScript compiles `.ts` → `.js`, so the import paths refer to the compiled output.

### Classes

```typescript
class VaultManager {
  // `private config` is shorthand for:
  //   private config: VaultConfig;
  //   constructor(config: VaultConfig) { this.config = config; }
  constructor(private config: VaultConfig) {}

  // async methods return Promises — use `await` to get the value
  async readFile(path: string): Promise<string> {
    return fs.readFile(path, "utf-8");
  }
}
```

### Generics (the angle bracket syntax)

```typescript
// T is a placeholder for "any type" — it gets filled in when used
function defineTool<T>(name: string, config: { handler: (args: T) => void }) { ... }

// When you call it, T gets inferred from the zod schema
defineTool("my_tool", {
  parameters: z.object({ name: z.string() }),  // T becomes { name: string }
  handler: ({ name }) => { ... }               // name is typed as string
});
```

### `async`/`await`

```typescript
// An async function always returns a Promise
async function doWork(): Promise<string> {
  const result = await someAsyncOperation();  // pauses here until done
  return result;
}

// Calling it:
const value = await doWork();  // also pauses
```

---

## Project Layout

This is an **npm workspaces monorepo** — a single git repo containing multiple packages that can depend on each other.

```
octopal/
├── .github/
│   ├── agents/
│   │   ├── octopal.agent.md      # Agent definition (repo-level, for dev)
│   │   └── test-octopal.agent.md # Test agent
│   └── plugin/
│       └── marketplace.json      # Copilot CLI marketplace registry
├── agents/
│   └── octopal.agent.md          # Agent definition (plugin-level)
├── skills/
│   ├── octopal/
│   │   └── SKILL.md              # Full instructions for plugin/external AI clients
│   ├── para/
│   │   └── SKILL.md              # PARA vault-organization skill (bundled)
│   └── github/
│       └── SKILL.md              # GitHub workflow conventions (bundled)
├── commands/
│   └── ingest.md                 # /octopal:ingest slash command
├── package.json                  # Root — defines workspaces, shared dev deps
├── tsconfig.json                 # Root — references all sub-projects
├── tsconfig.base.json            # Shared TypeScript compiler settings
├── packages/
│   ├── core/                     # @octopal/core — the shared library
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts          # Re-exports everything
│   │       ├── agent.ts          # Copilot SDK session + tool/skill wiring
│   │       ├── auth.ts           # Password hashing (scrypt), JWT minting/verification
│   │       ├── connector.ts      # Channel connector interface (Discord, web, etc.)
│   │       ├── tools.ts          # Vault + connector tools (defineTool-based, SDK-native)
│   │       ├── prompts.ts        # Core identity prompt (single source of truth)
│   │       ├── vault.ts          # Git + file operations on the vault
│   │       ├── para.ts           # PARA directory structure management
│   │       ├── tasks.ts          # Obsidian Tasks format parser/formatter
│   │       └── types.ts          # Shared TypeScript types (incl. ConnectorRegistryLike)
│   ├── cli/                      # @octopal/cli — command-line entry point
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts          # CLI argument parsing, routes to handlers
│   │       ├── setup.ts          # Interactive onboarding wizard
│   │       ├── skills.ts         # `octopal skills list/create` commands
│   │       └── client.ts         # Daemon WebSocket client (dual-mode CLI)
│   ├── server/                   # @octopal/server — daemon (HTTP + WebSocket)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts          # Entry point: parse args, start server
│   │       ├── server.ts         # Fastify app setup, OctopalAgent init
│   │       ├── protocol.ts       # WebSocket message type definitions
│   │       ├── connector-registry.ts # Tracks remote connectors + routes requests
│   │       ├── sessions.ts       # SessionStore: maps channel IDs → SDK sessions
│   │       ├── ws.ts             # WebSocket handler (auth, chat, connectors)
│   │       └── routes/
│   │           ├── auth.ts       # POST /auth/token, GET /auth/tokens, DELETE /auth/token/:id
│   │           ├── chat.ts       # POST /chat (one-shot request/response)
│   │           └── vault.ts      # GET /vault/structure, GET /vault/note/*, POST /vault/search
│   ├── connector-discord/        # @octopal/connector-discord — in-process Discord bot
│   │   └── src/
│   │       ├── connector.ts      # DiscordConnector class (uses SessionStore directly)
│   │       ├── messages.ts       # Message splitting utility
│   │       └── tools.ts          # Discord-specific agent tools
│   └── connector/                # @octopal/connector — remote connector runtime
│       └── src/
│           ├── index.ts          # Entry point + re-exports
│           └── connector.ts      # OctopalRemoteConnector class + shellHandler
└── vault-template/               # Starter vault (copy this for new vaults)
```

### Plugin structure

The repo root can be installed as a Copilot CLI plugin. When installed:
- `agents/octopal.agent.md` — the agent persona and instructions
- `skills/octopal/SKILL.md` — full knowledge assistant instructions for the plugin context
- `commands/ingest.md` — `/octopal:ingest` slash command

### How packages reference each other

- `packages/cli/package.json` has `"@octopal/core": "*"` in dependencies
- npm workspaces automatically links this to the local `packages/core`
- `packages/cli/tsconfig.json` has `"references": [{ "path": "../core" }]` so TypeScript knows to build core first

---

## How the Build Works

```bash
npm run build          # Runs `tsc` in each package (core first, then cli)
npm run typecheck      # Same as build but type-checks without emitting (uses tsc --build at root)
```

What happens:
1. TypeScript reads `tsconfig.json` at the root, which references `packages/core`, `packages/cli`, and `packages/server`
2. It builds `core` first (no dependencies), outputting `.js` and `.d.ts` files to `packages/core/dist/`
3. Then it builds `cli` and `server`, which import from `@octopal/core` (resolved via npm workspace link to `packages/core/dist/`)

**To add a new package** (e.g., `packages/discord`):
1. Create `packages/discord/package.json` with `"@octopal/core": "*"` as a dependency
2. Create `packages/discord/tsconfig.json` extending `../../tsconfig.base.json` with a reference to `../core`
3. Add `{ "path": "packages/discord" }` to the root `tsconfig.json` references
4. Run `npm install` to link the workspace

---

## Module-by-Module Guide

### `config.ts` — Configuration

Manages `~/.octopal/config.toml` and resolves the vault location.

**Config file format:**
```toml
vaultRemoteUrl = "https://github.com/username/vault.git"

[server]
port = 3847

[scheduler]
enabled = true
tickIntervalSeconds = 60
```

**Key functions:**
- `loadConfig()` — Reads `~/.octopal/config.toml`, merges with env var overrides (`OCTOPAL_VAULT_PATH`, `OCTOPAL_VAULT_REMOTE`), returns a `ResolvedConfig` with all paths filled in.
- `saveConfig(config)` — Merges new values into the existing config file.
- `isConfigured(config)` — Returns true if a vault repo or remote URL is set.

**Resolution order:**
1. Environment variables (`OCTOPAL_HOME`, `OCTOPAL_VAULT_PATH`, `OCTOPAL_VAULT_REMOTE`) — highest priority
2. `~/.octopal/config.toml` — created by `octopal setup`
3. Defaults — config at `~/.octopal/`, vault at `~/.octopal/vault/`

`OCTOPAL_HOME` overrides the base directory for all octopal data (config, vault). This is used by the test agent to create isolated test environments.

### `vault.ts` — Vault Management

The `VaultManager` class handles all interactions with the PARA vault on disk. It wraps git and filesystem operations.

**Key methods:**
- `init()` — Clones the vault repo (if remote URL given) or creates a local directory. Pulls latest if it already exists.
- `readFile(path)` / `writeFile(path, content)` — Read/write files relative to the vault root.
- `appendToFile(path, content)` — Append to existing file (or create it).
- `deleteFile(path)` — Remove a file from the vault.
- `commitAndPush(message)` — `git add -A && git commit && git push`. Handles offline gracefully.
- `search(query)` — Walks all `.md` files and returns lines matching the query.

**How git operations work:**
```
init()  →  git clone / git pull --rebase --autostash
writeFile()  →  just writes to disk (no git yet)
commitAndPush()  →  git add -A && git commit -m "..." && git push
```

Changes accumulate on disk. The agent calls `commit_changes` when it's done processing.

### `para.ts` — PARA Structure

The `ParaManager` class manages the PARA directory structure. It uses `VaultManager` for file operations.

**Key methods:**
- `ensureStructure()` — Creates Projects/, Areas/, Resources/, Archives/, Inbox/, Templates/ if they don't exist.
- `getStructure()` — Returns a text tree of the vault contents (fed to the agent as context).
- `createItem(category, name, content)` — Creates a new subfolder with an `index.md` (or a file in Inbox).
- `moveItem(from, to, name)` — Moves items between categories.
- `createInboxNote(title, content)` — Creates a timestamped note in Inbox/.

### `tasks.ts` — Obsidian Tasks

The `TaskManager` class parses and creates tasks in [Obsidian Tasks emoji format](https://publish.obsidian.md/tasks/Reference/Task+Formats/About+Task+Formats).

**The format:**
```markdown
- [ ] Task description ⏫ 🛫 2024-01-10 📅 2024-01-15 ➕ 2024-01-08
- [x] Done task ✅ 2024-01-14
- [-] Cancelled task
- [/] In-progress task
```

**Emoji meanings:**
| Emoji | Meaning |
|-------|---------|
| 🔺 | Highest priority |
| ⏫ | High priority |
| 🔼 | Medium priority |
| 🔽 | Low priority |
| ⏬ | Lowest priority |
| 📅 | Due date |
| 🛫 | Start date |
| ⏳ | Scheduled date |
| ➕ | Created date |
| ✅ | Done date |
| 🔁 | Recurrence |

**Key methods:**
- `parse(line)` — Parses a markdown task line into a `Task` object.
- `format(task)` — Formats a `Task` object back into a markdown line.
- `create(description, options)` — Creates a new task line (auto-adds today's created date).
- `findAll(markdown)` — Finds all tasks in a markdown document.
- `completeTask(markdown, lineNumber)` — Marks a task as done.

### `agent.ts` — Copilot SDK Agent

This is the brain of octopal. It creates a Copilot SDK session with custom tools that can read/write the vault.

**How it works:**
1. `OctopalAgent.init()` starts the Copilot CLI server and initializes the vault
2. `createSession()` creates a new AI session with:
   - A system prompt explaining the PARA method and conventions
   - The current vault structure as context
   - User-defined conventions from `Meta/conventions.md` (if present)
   - Custom tools the AI can call (read_vault_structure, write_note, create_task, etc.)
3. `sendAndWait(session, prompt)` sends a message and waits for the AI to finish
4. `run(prompt)` is a convenience that creates a session, sends one prompt, and cleans up

**The tools** are defined in `tools.ts` using the Copilot SDK's `defineTool()` directly.

### `prompts.ts` — Shared Prompts

Single source of truth for all prompt strings. Exports:
- `SYSTEM_PROMPT` — core identity + knowledge-building philosophy (generic, no PARA specifics)
- `SETUP_PROMPT` — onboarding interview instructions (used by `cli/setup.ts`)

PARA-specific details (directory structure, task format, etc.) live in `skills/para/SKILL.md` and are loaded via the SDK's `skillDirectories` support.

### `tools.ts` — Tool Definitions

Vault tools built with the Copilot SDK's `defineTool()`. Key exports:
- `buildVaultTools(deps)` — returns all vault tools as a `Tool[]` array
- `ToolDeps` — interface: `{ vault, para, tasks, client, scheduler?, connectors? }`

Notable tools:
- `analyze_input` — runs the two-phase preprocessor (deterministic + semantic matching) against the knowledge base. The PARA skill instructs the agent to call this before processing raw input.
- `read_note`, `write_note`, `append_to_note` — vault file operations
- `save_knowledge`, `lookup_knowledge` — knowledge base management
- `commit_changes` — git commit and push
- `schedule_task` — create a recurring or one-off scheduled task (persisted to vault as TOML)
- `cancel_scheduled_task` — remove a scheduled task by ID (builtins cannot be cancelled)
- `list_scheduled_tasks` — list all active scheduled tasks
- `list_connectors` — list connected remote devices and their capabilities
- `remote_execute` — execute a shell command on a remote connected machine

### `auth.ts` — Authentication

Provides password hashing and JWT token management using only built-in Node.js crypto (no native dependencies).

**Key exports:**
- `hashPassword(password)` — Hash a password using scrypt with random salt. Returns `salt:hash` string.
- `verifyPassword(password, hash)` — Verify a password against a stored hash using timing-safe comparison.
- `generateTokenSecret()` — Generate a random 256-bit hex string for JWT signing.
- `mintToken(secret, options)` — Create a signed JWT (HS256) with scopes, label, and expiry.
- `verifyToken(secret, token)` — Verify and decode a JWT. Throws on invalid/expired tokens.
- `TokenPayload` — Type: `{ jti, sub, scopes, iat, exp }`

### `knowledge.ts` — Knowledge Index

Scans `Resources/Knowledge/` to build an in-memory index of all knowledge entries (titles, aliases, backlink context). Provides deterministic string matching (Phase 1 of the preprocessor) and formatting helpers for the LLM.

**Key exports:**
- `buildKnowledgeIndex(vault)` — Scans knowledge entries, parses frontmatter, collects backlinks from all vault notes
- `deterministicMatch(index, input)` — Case-insensitive substring matching of titles/aliases against raw input
- `formatIndexForLLM(index)` — Formats the index for the Haiku preprocessor prompt

### `preprocessor.ts` — Two-Phase Preprocessor

Runs before the main agent during ingest. Phase 1 (deterministic) matches known entities by title/alias. Phase 2 (Haiku) identifies semantic matches and new entities.

**Key exports:**
- `runPreprocessor(client, vault, rawInput)` — Returns matched knowledge entries, high-confidence new aliases, low-confidence triage items, and new entity candidates

### `schedule-types.ts` — Schedule Types & Cron Parser

Types for scheduled task definitions and a minimal hand-rolled 5-field cron matcher (no external dependencies).

**Key types:**
- `ScheduledTask` — runtime representation of a scheduled task (id, name, schedule, prompt, enabled, builtin, once, etc.)
- `ScheduleFile` — the shape of a `.toml` schedule file in the vault
- `ScheduleHistoryEntry` — a record of a task execution (timestamps, success/failure, summary)

**Key functions:**
- `toCron(input)` — Converts interval sugar to cron, or returns cron as-is. Supported sugar: `"hourly"`, `"daily"`, `"weekly"`, `"monthly"`, `"every 30m"`, `"every 6h"`.
- `cronMatches(cron, date)` — Returns true if a `Date` matches a 5-field cron expression. Supports ranges, steps, lists, and named days/months (e.g., `MON-FRI`).

### `scheduler.ts` — Task Scheduler

Loads schedules from the vault, runs a periodic tick loop, and executes due tasks as one-shot agent sessions.

**How it works:**
1. `Scheduler` is created with `{ agent, vault, enabled, tickIntervalSeconds }`
2. `registerBuiltin(task)` adds code-defined schedules (e.g., vault-sync). These cannot be cancelled via the agent tool.
3. `start()` loads all `.toml` files from `<vault>/Meta/schedules/`, then begins a `setTimeout`-based tick loop (default: 60 seconds)
4. On each tick, it checks which tasks are due (via `cronMatches`). Recurring tasks don't re-run if already executed this minute. One-off tasks fire when their scheduled time has passed.
5. Execution creates a one-shot agent session (via `agent.run()`), sends the prompt, and collects the response. Builtins (prompts starting with `__builtin:`) bypass the agent and run directly (e.g., `vault.pull()`).
6. Results are appended to `Meta/schedules/history.md` as a markdown table row.
7. One-off tasks are deleted from the vault after execution.

**Key methods:**
- `start()` / `stop()` — lifecycle
- `reload()` — re-reads schedule files from vault (called by `schedule_task` / `cancel_scheduled_task` tools)
- `listTasks()` — returns all active schedules
- `registerBuiltin(task)` — add a code-defined schedule

**Schedule file format** (`Meta/schedules/*.toml`):
```toml
name = "Daily Digest"
schedule = "0 9 * * MON-FRI"   # cron or interval sugar ("daily", "every 30m")
prompt = "Generate my daily digest of open tasks and upcoming deadlines"
# skill = "para"               # optional: target a specific skill
# enabled = false              # optional: disable without deleting
# once = "2026-02-14T09:00:00" # for one-off tasks (mutually exclusive with schedule)
```

**Builtin tasks:**
- `vault-sync` — runs `git pull` every 30 minutes to keep the vault in sync

### `cli/index.ts` — CLI Entry Point

Parses command-line arguments and routes to the right handler. Reads config from `~/.octopal/config.toml` (created by `octopal setup`).

Commands:
- `octopal setup` — Launches the interactive onboarding agent
- `octopal chat <text>` — Chat with Octopal (uses daemon if running, falls back to standalone)
- `octopal ingest <text>` — Processes raw text through the agent with PARA skill guidance
- `octopal skills list|create` — Manage skills

**Dual-mode chat:** The `chat` command first attempts to connect to a running daemon via WebSocket (using `DaemonClient` from `client.ts`). If the daemon is available, the message is routed through it — sharing sessions with other connected clients. If not, it falls back to a standalone `OctopalAgent` session.

### `cli/setup.ts` — Interactive Onboarding Agent

A standalone script that creates a new PARA vault and walks the user through an interactive interview. It uses the Copilot SDK's `onUserInputRequest` handler to ask questions in the terminal.

**How it works:**
1. Checks that `gh` CLI is installed and authenticated
2. Asks for a GitHub repo name, checks if it exists via `gh repo view`, creates it with `gh repo create` if not
3. Clones the repo to `~/.octopal/vault/` using `gh repo clone` (handles auth)
4. Creates the PARA directory structure and copies templates
5. Starts a Copilot session with a system prompt that instructs the AI to conduct an interview
6. The AI uses `ask_user` to ask questions one at a time (name, projects, areas, tasks, etc.)
7. Each user answer comes through the `onUserInputRequest` handler, which uses Node's `readline` to prompt in the terminal
8. After ~8-10 questions, the AI uses write_note/append_to_note tools to populate the vault
9. Finally commits everything to git

**The `onUserInputRequest` pattern:**
```typescript
const session = await client.createSession({
  onUserInputRequest: async (request) => {
    // request.question — the question the AI wants to ask
    // request.choices — optional multiple-choice options
    // request.allowFreeform — whether free text is accepted
    const answer = await rl.question(request.question);
    return { answer, wasFreeform: true };
  },
});
```

This is how any connector can implement interactive conversations — Discord, web UI, etc. would implement the same handler pattern with their own I/O.

### `connector.ts` — Channel Connector Interface

Defines the `OctopalConnector` interface for channel integrations (Discord, web, Telegram, etc.):

```typescript
interface OctopalConnector {
  readonly name: string;
  connect(daemonUrl: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
}
```

Connectors are **WebSocket clients to the daemon**. They authenticate with a token (requiring the `connector` scope), register themselves via `connector.register`, then forward channel messages as `connector.message` and handle `connector.reply` to send responses back.

Also defines `InboundMessage` and `OutboundMessage` types for channel-agnostic message passing.

### `types.ts` — Shared Types

Includes `ConnectorRegistryLike` — a minimal interface used by `tools.ts` to interact with the `ConnectorRegistry` without depending on the server package. This enables `list_connectors` and `remote_execute` tools to route requests to remote connectors.

### `server/` — Daemon (Central Agent Server)

The Octopal daemon — a Fastify server that owns the `OctopalAgent` instance and routes all interactions through it. All clients (CLI, connectors) connect via WebSocket.

**Architecture:**
- Single `OctopalAgent` instance, initialized at startup
- `Scheduler` runs alongside the agent — loads schedules from vault, ticks every 60s, executes due tasks as one-shot agent sessions
- `ConnectorRegistry` tracks connected remote connectors, their capabilities, and routes request/response messages
- `SessionStore` maps deterministic IDs (`{connector}:{channelId}`) to persistent SDK sessions
- Sessions use `infiniteSessions` for automatic context compaction
- Auth: admin password (scrypt hash) → mints scoped JWT bearer tokens for clients
- Vault write safety via `VaultManager` write lock (no job queue needed)

**REST API:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/token` | Password | Mint a bearer token |
| `GET` | `/auth/tokens` | Bearer (admin) | List issued tokens |
| `DELETE` | `/auth/token/:id` | Bearer (admin) | Revoke a token |
| `POST` | `/chat` | Bearer (chat) | One-shot chat (request/response) |
| `GET` | `/vault/structure` | Bearer (read) | Read PARA structure |
| `GET` | `/vault/note/*` | Bearer (read) | Read a note |
| `POST` | `/vault/search` | Bearer (read) | Full-text search |
| `GET` | `/health` | None | Health check + active session count |

**WebSocket Protocol (`/ws`):**

Auth via query param (`?token=...`) or first `{ type: "auth", token }` message.

*Client → Daemon:*
| Type | Scope | Description |
|------|-------|-------------|
| `chat.send` | `chat` | Send a message (streaming response via `chat.delta` → `chat.complete`) |
| `connector.register` | `connector` | Register as a connector (includes name, capabilities, metadata) |
| `connector.message` | `connector` | Forward a channel message or push data proactively (optional `dataType`) |
| `connector.response` | `connector` | Response to a `connector.request` (includes `requestId`, `result`/`error`) |
| `ping` | — | Heartbeat |

*Daemon → Client:*
| Type | Description |
|------|-------------|
| `auth.ok` / `auth.error` | Authentication result |
| `chat.delta` | Streaming response token |
| `chat.complete` | Response finished |
| `chat.error` | Error during chat |
| `connector.ack` | Registration confirmed |
| `connector.request` | Request an action from a connector (`requestId`, `capability`, `action`, `params`) |
| `connector.reply` | Reply to send back to channel |
| `pong` | Heartbeat response |

**Token scopes:** `chat`, `read`, `connector`, `admin`. A Discord bot gets `["connector"]`, a CLI gets `["chat", "read"]`, a dashboard gets `["read"]`.

**Running:**
```bash
octopal serve --set-password     # Set admin password (first time)
octopal serve                    # Start daemon on port 3847
octopal serve --port 8080        # Custom port
```

**Config extension:** `~/.octopal/config.toml` gains `server` and `scheduler` sections:
```toml
vaultRemoteUrl = "https://github.com/user/vault.git"

[server]
port = 3847
passwordHash = "salt:hash..."
tokenSecret = "hex..."

[scheduler]
enabled = true
tickIntervalSeconds = 60
```

### `Meta/conventions.md` — User-Defined Conventions

A markdown file inside the vault that lets users customize how the agent organizes content. The agent reads it on every session and appends it to the system prompt.

**Location:** `<vault>/Meta/conventions.md`

**How it works:**
- `OctopalAgent.createSession()` attempts to read the file from the vault
- If it exists, the content is appended to the system prompt under a `## User Conventions` heading
- If it doesn't exist, the agent falls back to its built-in defaults
- The setup flow copies a default version from `vault-template/Meta/conventions.md`

**Default sections:**
- **File Structure** — directory layout conventions (subdirectories with `index.md`, kebab-case names)
- **Default Areas** — seed list of common areas (Work, Health, Finances, etc.)
- **Note Formatting** — frontmatter fields, wikilink preferences
- **Task Defaults** — created date, default priority, due date inference
- **Custom Instructions** — free-form user preferences

Users can edit this file in Obsidian like any other note. Changes take effect on the next ingest.

### Knowledge Base — `Resources/Knowledge/`

A wiki of atomic facts (people, terms, organizations) that the agent reads and updates across sessions. See `Resources/Knowledge/PHILOSOPHY.md` in the vault for the full design rationale.

**Location:** `<vault>/Resources/Knowledge/{People,Terms,Organizations}/`

**Entry format:**
```markdown
---
title: Dr. Chen
aliases: [psychiatrist, Dr. C, my psychiatrist]
category: people
created: 2026-02-08
---

Psychiatrist at Wellness Partners.
- Phone: 555-0123
```

The `aliases` field enables deterministic matching — any alias in the list is recognized automatically on future ingests.

**How it works during ingest:**

1. **Phase 1 (deterministic):** `knowledge.ts` scans all knowledge entries, builds an index of titles + aliases, and does case-insensitive string matching against the input. Fast, free, no LLM.
2. **Phase 2 (semantic):** `preprocessor.ts` sends unmatched text + the index (including backlink context) to Haiku for semantic matching. Returns high-confidence aliases (auto-applied), low-confidence items (triaged), and new entity candidates.
3. **Main agent:** Receives matched knowledge as context, creates wikilinks to entries, saves new knowledge via `save_knowledge`, and flags uncertain links with ⚠️.

**Tools:**
- `lookup_knowledge` — search knowledge entries (fallback for preprocessor)
- `save_knowledge` — create/update an entry with category, name, content, aliases
- `add_triage_item` — queue uncertain associations for user review in `Inbox/Triage.md`

**Journal:** Each ingest produces a journal entry in `Resources/Knowledge/Journal/` documenting what the agent did and why — providing an audit trail for decision-making.

**Triage:** Low-confidence associations are linked immediately with a ⚠️ prefix and queued in `Inbox/Triage.md` for batch review. The `octopal triage` command (planned) will process user approvals/rejections.

---

## The Copilot SDK

The Copilot SDK (`@github/copilot-sdk`) lets you embed AI agent workflows in your app. Here's the mental model:

```
Your Code (octopal)
    │
    ▼
CopilotClient          ← manages the CLI process lifecycle
    │
    ▼
CopilotSession         ← a conversation with tools, system prompt, history
    │
    ▼
Copilot CLI (server)   ← does the actual AI reasoning (runs as a subprocess)
    │
    ▼
GitHub Copilot API     ← the LLM (Claude, GPT, etc.)
```

### Key concepts

1. **CopilotClient** — You create one client per process. It spawns the Copilot CLI as a subprocess and communicates over JSON-RPC.

2. **CopilotSession** — Each session is an independent conversation. It has its own message history, tools, and system prompt. You can have multiple sessions.

3. **Tools** — Functions you define that the AI can call. The AI decides when to use them based on the tool name, description, and the conversation. You define them with `defineTool(name, { description, parameters, handler })`.

4. **System prompt** — Instructions that shape the AI's behavior. In `append` mode (default), your content is added after the SDK's built-in safety instructions.

5. **`sendAndWait()`** — Sends a prompt and blocks until the AI is done (including any tool calls it makes). Returns the final text response.

### Authentication

The SDK authenticates with GitHub Copilot. It tries these in order:
1. `githubToken` option passed to `CopilotClient`
2. `GITHUB_TOKEN` or `COPILOT_GITHUB_TOKEN` environment variable
3. Stored OAuth tokens from `gh auth login`

---

## Skills System

Octopal uses the Copilot SDK's native **skill directories** for extensibility. Skills are directories containing a `SKILL.md` file with YAML frontmatter and markdown instructions.

### Three-Tier Skill Resolution

When `OctopalAgent.createSession()` is called, it passes three `skillDirectories` to the SDK:

1. **Bundled** (`<install>/skills/`) — shipped with octopal. Includes `para` (vault organization) and `github` (workflow conventions).
2. **Vault** (`<vault>/Meta/skills/`) — prompt-only skills synced via git, editable in Obsidian.
3. **Local** (`~/.octopal/skills/`) — user-installed skills.

The SDK automatically discovers `SKILL.md` files, parses their frontmatter, and injects their instructions into the session prompt.

### Creating a Skill

```bash
octopal skills create my-skill
# Creates ~/.octopal/skills/my-skill/SKILL.md
```

Or manually create a directory with a `SKILL.md`:

```markdown
---
name: my-skill
description: >
  What this skill does.
---

# My Skill

Instructions for the agent when this skill is active.
```

### Disabling Skills

Pass `disabledSkills` to `createSession()`:

```typescript
const session = await agent.createSession({
  disabledSkills: ["para"],  // disable the PARA vault-organization skill
});
```

### User Identity

Place `Meta/identity.md` in your vault to inject personal context (name, location, role, preferences) into every session. This is read and appended to the system prompt automatically.

---

## How to Add a New Agent Tool

Tools are defined in `packages/core/src/tools.ts` in `buildVaultTools()`. They use the Copilot SDK's `defineTool()` directly.

### Step-by-step

1. **Define the tool** in the `buildVaultTools()` return array:

```typescript
defineTool("my_new_tool", {
  description: "Does something useful with the vault",
  parameters: z.object({
    someParam: z.string().describe("What this parameter is for"),
    optionalParam: z.number().optional().describe("An optional number"),
  }),
  handler: async ({ someParam, optionalParam }: any) => {
    const result = await vault.readFile(someParam);
    return result;  // Return a string — this is what the AI sees
  },
}),
```

2. **Rebuild**: `npm run build`

The tool is now automatically available in the standalone CLI and any connector.

### Tips for good tools

- **Descriptive names and descriptions** — the AI uses these to decide when to call your tool
- **Use `.describe()` on Zod fields** — the AI sees these descriptions as parameter documentation
- **Return useful strings** — the tool's return value is shown to the AI as the result
- **Keep tools focused** — one tool per operation, not Swiss Army knives
- **Error handling** — throw errors for failures; the SDK will show the error to the AI

---

## How to Build a New Connector

There are two types of connectors: **remote connectors** (run on separate machines, connect via WebSocket) and **in-process connectors** (run inside the daemon, like Discord). Most new connectors should be remote.

### Remote Connectors (recommended)

Remote connectors use the `@octopal/connector` package — a lightweight runtime that connects to the daemon, registers capabilities, and handles requests.

#### Architecture

```
Remote Machine (e.g. work Mac)
    │
    ▼
OctopalRemoteConnector          ← WS client with auto-reconnect
    │ WebSocket (authenticated)
    ▼
Octopal Daemon (home server)
    │
    ▼
ConnectorRegistry → Agent Tools → OctopalAgent → SDK → LLM
```

#### Quick start

```typescript
import { OctopalRemoteConnector, shellHandler } from "@octopal/connector";

const connector = new OctopalRemoteConnector({
  name: "work-mac",                                    // unique name
  daemonUrl: "wss://octopal.example.com/ws",           // daemon URL
  token: "eyJ...",                                     // connector-scoped JWT
  capabilities: ["shell"],                             // what this connector can do
  metadata: { os: "darwin", hostname: "Ryans-MBP" },   // optional metadata
});

// Register the built-in shell handler
connector.onRequest("shell", shellHandler());

// Or register a custom capability handler
connector.onRequest("clipboard", async (action, params) => {
  if (action === "read") {
    const { execSync } = await import("node:child_process");
    return { text: execSync("pbpaste").toString() };
  }
  throw new Error(`Unknown clipboard action: ${action}`);
});

await connector.connect();
// Connector is now online. The agent can call remote_execute("work-mac", "...").
```

#### Proactive push

Connectors can push data to the daemon without being asked (e.g. meeting transcripts, periodic screenshots):

```typescript
connector.send("transcript-channel", "Meeting transcript:\n...", "transcript");
```

The daemon routes this through the agent session for that connector+channel, just like a regular `connector.message`.

#### Key points

- **Auto-reconnect:** The connector automatically reconnects with exponential backoff if the daemon disconnects.
- **Capabilities are freeform strings.** Register whatever makes sense (e.g. `"shell"`, `"clipboard"`, `"slack"`). The agent's `remote_execute` tool requires the `"shell"` capability; custom capabilities can be used by skills via direct instructions.
- **Auth:** Connectors need a token with the `connector` scope. Create one with `POST /auth/token`.
- **Naming:** Connector names must be unique. The daemon rejects duplicate registrations.
- **Session context:** Connected devices and their capabilities are injected into the agent's system prompt, so skills can reference them.

#### Skills + Connectors

Skills (prompt-only `SKILL.md` files) can target specific connectors by instructing the agent to use `remote_execute`:

```markdown
# Meta/skills/workiq/SKILL.md
---
name: workiq
description: Query work metrics via WorkIQ on the work machine
---

When the user asks about work metrics or sprint data:
1. Use `remote_execute` with connector "work-mac" to run:
   `copilot -p "use workiq: <query>"`
2. Parse and present the results.

If "work-mac" is not connected, tell the user.
```

### In-process Connectors

For channels that need tight integration with the daemon (like Discord, which uses the `SessionStore` directly), create a package in `packages/connector-<name>/` that imports from `@octopal/core` and is started by the daemon. See the [Discord Connector](#discord-connector) section for a working example.

### Adding a new package (either type)

1. Create `packages/connector-<name>/package.json` and `tsconfig.json` (extend `../../tsconfig.base.json`)
2. Add `{ "path": "packages/connector-<name>" }` to root `tsconfig.json` references
3. Run `npm install && npm run build`

---

## Discord Connector

The Discord connector (`@octopal/connector-discord`) is a built-in connector that runs **inside the daemon process** rather than as an external WebSocket client. It uses the `SessionStore` directly, avoiding WS overhead.

### Architecture

```
octopal serve
├── Fastify + WS (CLI, external connectors)
├── DiscordConnector (discord.js → SessionStore)
└── SessionStore + OctopalAgent
```

### Setup

1. **Create a Discord bot** at [discord.com/developers](https://discord.com/developers/applications):
   - New Application → Bot → copy the bot token
   - Enable **Message Content Intent** under Bot → Privileged Gateway Intents
   - Generate an invite URL under OAuth2 → URL Generator with `bot` scope and `Send Messages` + `Read Message History` permissions
   - Invite the bot to your server (it responds to DMs, not server messages)

2. **Configure octopal** — add to `~/.octopal/config.json`:

   ```json
   {
     "discord": {
       "botToken": "your-bot-token",
       "allowedUsers": ["123456789012345678"]
     }
   }
   ```

   Or use environment variables:
   ```bash
   OCTOPAL_DISCORD_BOT_TOKEN=your-bot-token
   OCTOPAL_DISCORD_ALLOWED_USERS=123456789012345678,987654321098765432
   ```

3. **Start the daemon** — `octopal serve` will automatically start the Discord connector if `discord.botToken` is configured.

### How to find your Discord user ID

Enable Developer Mode in Discord (Settings → Advanced → Developer Mode), then right-click your username and select "Copy User ID".

### Design details

- **DMs only** — the bot only responds to direct messages, not guild channel messages.
- **User whitelist** — only Discord user IDs in `allowedUsers` can interact with the bot. Others are silently ignored.
- **Sessions** — each Discord user gets their own session (`discord:{userId}`), preserving conversation context across messages.
- **Typing indicator** — the bot shows a typing indicator while the agent processes the message.
- **Message splitting** — responses longer than 2000 characters are automatically split at paragraph/line/sentence boundaries.

### Key files

| File | Purpose |
|------|---------|
| `packages/connector-discord/src/connector.ts` | Main `DiscordConnector` class |
| `packages/connector-discord/src/messages.ts` | Message splitting utility |
| `packages/server/src/server.ts` | Starts connector if Discord is configured |
| `packages/core/src/config.ts` | `DiscordConfig` type and loading |

---

## Common Tasks

### Adding a new npm dependency

```bash
# Add to a specific package
cd packages/core
npm install some-package

# Add a dev dependency to the root
cd /path/to/octopal
npm install --save-dev some-dev-tool
```

### Running the CLI during development

```bash
# Build first
npm run build

# Run (config must exist — run setup first, or create ~/.octopal/config.json manually)
node packages/cli/dist/index.js setup
node packages/cli/dist/index.js ingest "test note"
```

### Checking types without building

```bash
./node_modules/.bin/tsc --build --dry
```

### Cleaning build artifacts

```bash
npm run clean
```

### Upgrading the Copilot SDK

1. Get the new tarball: `cd ~/Documents/copilot-sdk/nodejs && git pull && npm install && npm run build && npm pack`
2. Copy it: `cp github-copilot-sdk-*.tgz /path/to/octopal/vendor/`
3. Update the version in `packages/core/package.json`
4. Run `npm install && npm run build`

### Testing with the test agent

There's a custom agent at `.github/agents/test-octopal.agent.md` that can be invoked from the Copilot CLI to test octopal in an isolated environment. It:

1. Builds octopal
2. Creates a temp directory with `OCTOPAL_HOME` pointed at it
3. Creates a local test vault (no GitHub repo needed)
4. Exercises the CLI features
5. Reports what passed/failed

To use it, ask the Copilot CLI to `@test-octopal` or describe what you want to test. The agent handles all environment isolation — it never touches `~/.octopal/`.

**Manual testing with an isolated environment:**
```bash
# Create isolated test env
export OCTOPAL_TEST_DIR=$(mktemp -d /tmp/octopal-test-XXXXXX)
export OCTOPAL_HOME="$OCTOPAL_TEST_DIR/home"
export OCTOPAL_VAULT_PATH="$OCTOPAL_TEST_DIR/vault"
mkdir -p "$OCTOPAL_HOME" "$OCTOPAL_VAULT_PATH"
cd "$OCTOPAL_VAULT_PATH" && git init && git commit --allow-empty -m "init"
echo 'vaultRemoteUrl = "https://github.com/test/vault.git"' > "$OCTOPAL_HOME/config.toml"

# Run commands
node packages/cli/dist/index.js ingest "test note"

# Clean up
rm -rf "$OCTOPAL_TEST_DIR"
```

---

## Troubleshooting

### "Cannot find module '@octopal/core'"
Run `npm install` at the root to ensure workspace links are set up.

### "Cannot find module 'node:fs/promises'"
Make sure `@types/node` is installed: `npm install --save-dev @types/node`

### Build errors about Zod types
The SDK uses Zod v4. Make sure `packages/core/package.json` depends on `"zod": "^4.x"`.

### "Octopal is not configured yet"
Run `octopal setup` to create `~/.octopal/config.json` and clone your vault. You can also set `OCTOPAL_VAULT_PATH` and `OCTOPAL_VAULT_REMOTE` environment variables as overrides.

### Copilot auth issues
Make sure you're logged in: `gh auth login`. The `gh` CLI handles all git and API authentication.

### Node version errors
This project requires Node 24+. Use `fnm use 24` or install via `fnm install 24`.
