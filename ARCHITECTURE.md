# Octopal — Architecture & Maintainer Guide

This document explains how octopal works, the patterns it uses, and how to extend it. It's written for someone who may not be deeply familiar with TypeScript or the Copilot SDK.

---

## Table of Contents

1. [TypeScript Crash Course](#typescript-crash-course)
2. [Project Layout](#project-layout)
3. [How the Build Works](#how-the-build-works)
4. [Module-by-Module Guide](#module-by-module-guide)
5. [The Copilot SDK](#the-copilot-sdk)
6. [How to Add a New Agent Tool](#how-to-add-a-new-agent-tool)
7. [How to Build a New Connector](#how-to-build-a-new-connector)
8. [Common Tasks](#common-tasks)
9. [Troubleshooting](#troubleshooting)

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
├── package.json              # Root — defines workspaces, shared dev deps
├── tsconfig.json             # Root — references all sub-projects for `tsc --build`
├── tsconfig.base.json        # Shared TypeScript compiler settings
├── packages/
│   ├── core/                 # @octopal/core — the shared library
│   │   ├── package.json      # Declares dependencies (copilot-sdk, zod)
│   │   ├── tsconfig.json     # Extends base, outputs to dist/
│   │   └── src/              # Source code (TypeScript)
│   │       ├── index.ts      # Re-exports everything
│   │       ├── agent.ts      # Copilot SDK session + tool definitions
│   │       ├── vault.ts      # Git + file operations on the vault
│   │       ├── para.ts       # PARA directory structure management
│   │       ├── tasks.ts      # Obsidian Tasks format parser/formatter
│   │       ├── ingest.ts     # Ingestion pipeline (orchestrates agent)
│   │       └── types.ts      # Shared TypeScript types
│   └── cli/                  # @octopal/cli — command-line entry point
│       ├── package.json      # Depends on @octopal/core
│       ├── tsconfig.json     # References core for build order
│       └── src/
│           └── index.ts      # CLI argument parsing, calls IngestPipeline
└── vault-template/           # Starter PARA vault (copy this for new vaults)
```

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
1. TypeScript reads `tsconfig.json` at the root, which references `packages/core` and `packages/cli`
2. It builds `core` first (no dependencies), outputting `.js` and `.d.ts` files to `packages/core/dist/`
3. Then it builds `cli`, which imports from `@octopal/core` (resolved via npm workspace link to `packages/core/dist/`)

**To add a new package** (e.g., `packages/server`):
1. Create `packages/server/package.json` with `"@octopal/core": "*"` as a dependency
2. Create `packages/server/tsconfig.json` extending `../../tsconfig.base.json` with a reference to `../core`
3. Add `{ "path": "packages/server" }` to the root `tsconfig.json` references
4. Run `npm install` to link the workspace

---

## Module-by-Module Guide

### `vault.ts` — Vault Management

The `VaultManager` class handles all interactions with the PARA vault on disk. It wraps git and filesystem operations.

**Key methods:**
- `init()` — Clones the vault repo (if remote URL given) or creates a local directory. Pulls latest if it already exists.
- `readFile(path)` / `writeFile(path, content)` — Read/write files relative to the vault root.
- `appendToFile(path, content)` — Append to existing file (or create it).
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
   - Custom tools the AI can call (read_vault_structure, write_note, create_task, etc.)
3. `sendAndWait(session, prompt)` sends a message and waits for the AI to finish
4. `run(prompt)` is a convenience that creates a session, sends one prompt, and cleans up

**The tools** are defined using `defineTool()` from the Copilot SDK + [Zod](https://zod.dev/) for parameter schemas. Each tool is a function the AI can call. See [How to Add a New Agent Tool](#how-to-add-a-new-agent-tool) below.

### `ingest.ts` — Ingestion Pipeline

The simplest module — it creates an agent and sends it a prompt asking it to process raw text. The agent uses its tools to read the vault, create notes, create tasks, and commit.

### `cli/index.ts` — CLI Entry Point

Parses command-line arguments and calls `IngestPipeline`. Reads config from environment variables (`OCTOPAL_VAULT_PATH`, `OCTOPAL_VAULT_REMOTE`).

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

## How to Add a New Agent Tool

Tools are defined in `packages/core/src/agent.ts` in the `buildTools()` method.

### Step-by-step

1. **Define the tool** using `defineTool()`:

```typescript
defineTool("my_new_tool", {
  // What the AI sees — be descriptive so it knows when to use this tool
  description: "Does something useful with the vault",
  
  // Parameter schema using Zod — defines what arguments the AI must provide
  parameters: z.object({
    someParam: z.string().describe("What this parameter is for"),
    optionalParam: z.number().optional().describe("An optional number"),
  }),
  
  // The function that runs when the AI calls this tool
  handler: async ({ someParam, optionalParam }) => {
    // Do your work here — read files, call APIs, etc.
    const result = await this.vault.readFile(someParam);
    return result;  // Return a string — this is what the AI sees as the tool's output
  },
}),
```

2. **Add it to the tools array** in `buildTools()` (it's already returned as an array).

3. **Rebuild**: `npm run build`

### Tips for good tools

- **Descriptive names and descriptions** — the AI uses these to decide when to call your tool
- **Use `.describe()` on Zod fields** — the AI sees these descriptions as parameter documentation
- **Return useful strings** — the tool's return value is shown to the AI as the result
- **Keep tools focused** — one tool per operation, not Swiss Army knives
- **Error handling** — throw errors for failures; the SDK will show the error to the AI

---

## How to Build a New Connector

A "connector" is a new package that provides a different way to interact with octopal (Discord bot, HTTP server, desktop app, etc.).

### Step-by-step

1. **Create the package directory:**
```bash
mkdir -p packages/myconnector/src
```

2. **Create `packages/myconnector/package.json`:**
```json
{
  "name": "@octopal/myconnector",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@octopal/core": "*"
  }
}
```

3. **Create `packages/myconnector/tsconfig.json`:**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "references": [
    { "path": "../core" }
  ]
}
```

4. **Add it to the root `tsconfig.json` references:**
```json
{
  "references": [
    { "path": "packages/core" },
    { "path": "packages/cli" },
    { "path": "packages/myconnector" }
  ]
}
```

5. **Run `npm install`** to link the workspace.

6. **Write your code** in `packages/myconnector/src/index.ts`:
```typescript
import { OctopalAgent } from "@octopal/core";

const agent = new OctopalAgent({
  vault: { localPath: process.env.OCTOPAL_VAULT_PATH! },
});

await agent.init();
const session = await agent.createSession();

// Use session.sendAndWait() or agent.run() to interact
const response = await agent.sendAndWait(session, "What are my current projects?");
console.log(response);

await session.destroy();
await agent.stop();
```

### Connector patterns

**One-shot** (CLI style): Use `agent.run(prompt)` — creates a session, sends one prompt, cleans up.

**Long-lived** (server/bot style): Use `agent.createSession()` once, then call `session.sendAndWait()` multiple times. The session maintains conversation history.

**Multiple users**: Create one `OctopalAgent` instance, then create a separate `CopilotSession` per user/conversation.

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

# Run
OCTOPAL_VAULT_PATH=~/my-vault node packages/cli/dist/index.js ingest "test note"
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

---

## Troubleshooting

### "Cannot find module '@octopal/core'"
Run `npm install` at the root to ensure workspace links are set up.

### "Cannot find module 'node:fs/promises'"
Make sure `@types/node` is installed: `npm install --save-dev @types/node`

### Build errors about Zod types
The SDK uses Zod v4. Make sure `packages/core/package.json` depends on `"zod": "^4.x"`.

### "OCTOPAL_VAULT_PATH environment variable is required"
Set the environment variable: `export OCTOPAL_VAULT_PATH=/path/to/your/vault`

### Copilot auth issues
Make sure you're logged in: `gh auth login` or set `GITHUB_TOKEN` environment variable.

### Node version errors
This project requires Node 24+. Use `fnm use 24` or install via `fnm install 24`.
