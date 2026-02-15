# 🐙 Octopal

A personal AI assistant with a persistent knowledge vault. Give it notes, brain dumps, or voice transcripts — it files them into your Obsidian vault and creates actionable tasks. Extensible via skills.

Ships with [PARA method](https://fortelabs.com/blog/para/) support out of the box, but designed so you can swap in your own vault organization system. Powered by the [GitHub Copilot SDK](https://github.com/github/copilot-sdk).

## Quick Start

### Prerequisites

- **Node.js 24+** (install via [fnm](https://github.com/Schniz/fnm): `fnm install 24`)
- **GitHub CLI (`gh`)** — [install](https://cli.github.com/), then `gh auth login`
- **GitHub Copilot** access (authenticated via `gh` CLI)

> **Optional**: Install [Bun](https://bun.sh) and [QMD](https://github.com/tobi/qmd) for semantic vault search: `bun install -g https://github.com/tobi/qmd`

### Setup

```bash
# Clone and install
git clone <this-repo>
cd octopal
npm install

# Build
npm run build

# Interactive vault setup (recommended)
node packages/cli/dist/index.js setup
# → Asks for your GitHub repo (e.g. username/vault)
# → Clones to ~/.octopal/vault/
# → Walks you through an interactive onboarding interview
# → Pre-populates your vault with projects, areas, and tasks
```

Config is saved to `~/.octopal/config.toml`. The vault lives at `~/.octopal/vault/`.

### Usage

```bash
# Chat with Octopal
node packages/cli/dist/index.js chat "What projects am I working on?"

# Ingest a quick note (vault must be set up first)
node packages/cli/dist/index.js ingest "Met with Alice about the website redesign. New colors by Friday."

# Pipe in longer content
cat meeting-notes.txt | node packages/cli/dist/index.js ingest -

# List installed skills
node packages/cli/dist/index.js skills list

# Create a new skill
node packages/cli/dist/index.js skills create my-skill

# Start the daemon (required for multi-channel use)
node packages/cli/dist/index.js serve --set-password   # first time: set admin password
node packages/cli/dist/index.js serve                  # start on default port 3847

# Get help
node packages/cli/dist/index.js --help
```

The agent will:
1. Analyze your input
2. Decide where it belongs in your PARA structure (Projects, Areas, Resources, or Inbox)
3. Create or update notes with proper frontmatter
4. Extract action items and create tasks in [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) format
5. Commit changes to git

## Project Structure

```
octopal/
├── packages/
│   ├── core/           # @octopal/core — shared library
│   │   └── src/
│   │       ├── agent.ts      # Copilot SDK session + tool/skill wiring
│   │       ├── connector.ts  # Channel connector interface
│   │       ├── tools.ts      # Vault tools (SDK defineTool) + analyze_input
│   │       ├── vault.ts      # Git operations + file I/O (with write lock)
│   │       ├── para.ts       # PARA method directory management
│   │       ├── tasks.ts      # Obsidian Tasks format parser/formatter
│   │       └── types.ts      # Shared TypeScript types
│   ├── cli/            # @octopal/cli — command-line interface
│   │   └── src/
│   │       ├── index.ts      # CLI entry point (chat, ingest, skills, serve)
│   │       ├── setup.ts      # Interactive onboarding
│   │       ├── skills.ts     # Skills list/create commands
│   │       └── client.ts     # Daemon WebSocket client (dual-mode CLI)
│   └── server/         # @octopal/server — daemon (central agent server)
├── builtin-skills/     # Bundled skills
│   ├── para/           # PARA vault-organization skill (default)
│   └── github/         # GitHub workflow conventions
├── vault-template/     # Starter template for a new vault
├── wiki/               # GitHub wiki (architecture, contributing, API docs)
└── package.json        # npm workspaces root
```

## Architecture

See the [wiki](wiki/) for detailed documentation:
- [Architecture](wiki/Architecture.md) — system design, packages, data flow
- [Contributing](wiki/Contributing.md) — development setup, adding tools/skills/connectors
- [Connectors](wiki/Connectors.md) — Discord, remote connectors, building your own
- [Daemon and API](wiki/Daemon-and-API.md) — REST endpoints and WebSocket protocol

## Skills

Octopal is extensible via **skills** — directories with a `SKILL.md` that inject instructions into the agent's prompt.

**Three-tier skill resolution:**
1. **Bundled** (`builtin-skills/`) — shipped with octopal (PARA, GitHub conventions)
2. **Vault** (`<vault>/Meta/skills/`) — synced via git, editable in Obsidian
3. **Local** (`~/.octopal/skills/`) — user-installed

```bash
# List all skills
octopal skills list

# Create a new skill
octopal skills create my-skill
# → Creates ~/.octopal/skills/my-skill/SKILL.md
```

## Vault Structure (PARA Method)

```
vault/
├── Projects/       # Active efforts with clear outcomes
├── Areas/          # Ongoing responsibilities (no end date)
├── Resources/      # Topics of interest, reference material
├── Archives/       # Completed/inactive items
├── Inbox/          # Raw notes before filing
└── Templates/      # Note templates for Obsidian
```

## Task Format

Tasks use the Obsidian Tasks emoji format:

```markdown
- [ ] Prepare project report ⏫ 🛫 2024-02-10 📅 2024-02-13 ➕ 2024-02-09
- [x] Review design mockups ✅ 2024-02-14
```

## Roadmap

- [x] **Phase 1**: Core agent + vault + CLI
- [x] **Phase 2**: Skills system + extensibility
- [x] **Phase 3**: Daemon architecture (central agent server, WebSocket protocol, session management)
- [ ] **Phase 4**: Discord connector (first channel integration)
- [ ] **Phase 5**: Desktop connectors (screenshots, audio, proactive reminders)

## License

MIT
