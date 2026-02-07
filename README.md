# 🐙 Octopal

A personal AI agent that implements the [PARA method](https://fortelabs.com/blog/para/) for knowledge management. Give it notes, brain dumps, or voice transcripts — it files them into your Obsidian vault and creates actionable tasks.

Powered by the [GitHub Copilot SDK](https://github.com/github/copilot-sdk).

## Quick Start

### Prerequisites

- **Node.js 24+** (install via [fnm](https://github.com/Schniz/fnm): `fnm install 24`)
- **GitHub Copilot** access (authenticated via `gh` CLI or environment variable)

### Setup

```bash
# Clone and install
git clone <this-repo>
cd octopal
npm install

# Build
npm run build

# Set up your vault (or create a new one from the template)
cp -r vault-template ~/my-vault
cd ~/my-vault && git init && git add -A && git commit -m "Initial vault"

# Configure
export OCTOPAL_VAULT_PATH=~/my-vault
export OCTOPAL_VAULT_REMOTE=git@github.com:you/my-vault.git  # optional
```

### Usage

```bash
# Ingest a quick note
node packages/cli/dist/index.js ingest "Met with Alice about the website redesign. She wants new colors by Friday."

# Pipe in longer content
cat meeting-notes.txt | node packages/cli/dist/index.js ingest -

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
│   │       ├── agent.ts    # Copilot SDK session + tool definitions
│   │       ├── vault.ts    # Git operations + file I/O for the vault
│   │       ├── para.ts     # PARA method directory management
│   │       ├── tasks.ts    # Obsidian Tasks format parser/formatter
│   │       └── ingest.ts   # Note ingestion pipeline
│   └── cli/            # @octopal/cli — command-line interface
│       └── src/
│           └── index.ts
├── vault-template/     # Starter template for a new PARA vault
├── ARCHITECTURE.md     # Detailed guide to maintaining and extending octopal
└── package.json        # npm workspaces root
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a detailed guide covering:
- How each module works
- How to add new agent tools
- How to build new connectors (Discord, desktop, etc.)
- TypeScript patterns used in this project

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

- [x] **Phase 1**: Core agent + PARA vault + CLI
- [ ] **Phase 2**: Persistent server process (HTTP API)
- [ ] **Phase 3**: Discord bot (text + voice)
- [ ] **Phase 4**: Desktop connectors (screenshots, audio, proactive reminders)

## License

MIT
