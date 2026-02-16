# 🐙 Octopal

I wanted to make my own OpenClaw-like personal agentic assistant powered by the [GitHub Copilot SDK](https://github.com/github/copilot-sdk). OpenClaw seemed very bloated and brittle given what I wanted for my own usecase, and I wanted to build on the amazing harness built by the Copilot CLI team.

Octopal is built around an ever-improving personal knowledge management "second brain." Give it notes, brain dumps, or voice transcripts — it files them into your [Obsidian](https://obsidian.md/) vault using the [PARA method](https://fortelabs.com/blog/para/) and creates actionable tasks. Connects via CLI, Discord, or VS Code.

Give Octopal additional capabilities with [skills](wiki/Skills-System.md).

## Getting Started

### Prerequisites

- **Node.js 24+** (install via [fnm](https://github.com/Schniz/fnm): `fnm install 24`)
- **GitHub CLI (`gh`)** — [install](https://cli.github.com/), then `gh auth login`
- **GitHub Copilot** access (authenticated via `gh` CLI)
- **Docker** and **Docker Compose** (for running the daemon)

### 1. Bootstrap Your Vault

First, create your personal knowledge vault. This is a one-time setup:

```bash
git clone https://github.com/RyanHecht/octopal && cd octopal
npm install && npm run build

octopal setup
```

The setup wizard will:

- Ask for (or create) a GitHub repo for your vault (e.g. `username/vault`)
- Clone it to `~/.octopal/vault/` and initialize the PARA directory structure
- Walk you through a **10-minute AI onboarding interview** that populates your vault with your projects, areas, and tasks

### 2. Deploy

Once your vault repo exists on GitHub, deploy with Docker:

```bash
cp .env.example .env
# Edit .env — set VAULT_REMOTE, GH_TOKEN, OCTOPAL_PASSWORD
docker compose up -d
```

This starts the Octopal daemon (port 3847) and a web-based vault viewer (code-server, port 8443). See [Docker Deployment](wiki/Docker-Deployment.md) for Traefik TLS and production setup.

### 3. Connect

Talk to Octopal through any channel:

- **Discord** — DMs and threads (configure `DISCORD_*` vars in `.env`)
- **CLI** — `octopal chat "What should I work on today?"`
- **VS Code** — experimental extension in `extensions/octopal-vscode/`
- **Obsidian** — open the vault directly; changes sync via git

The agent will analyze your input, file it into your PARA structure, extract action items as [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks), and commit changes to git.

> **Local development**: You can also run the daemon directly with `octopal serve` instead of Docker. See the [CLI Reference](wiki/CLI-Reference.md) for all commands.

## Project Structure

```
octopal/
├── packages/
│   ├── core/                 # @octopal/core — shared library (agent, vault, tools, PARA)
│   ├── cli/                  # @octopal/cli — command-line interface
│   ├── server/               # @octopal/server — Fastify daemon (HTTP + WebSocket)
│   ├── connector/            # @octopal/connector — remote connector runtime
│   └── connector-discord/    # @octopal/connector-discord — Discord bot integration
├── builtin-skills/           # Bundled skills (para, github, self-knowledge)
├── extensions/
│   └── octopal-vscode/       # VS Code extension (chatSessionsProvider API)
├── vault-template/           # Starter template for new vaults
├── wiki/                     # GitHub wiki source (architecture, API docs, guides)
├── Dockerfile                # Daemon container
├── docker-compose.yml        # Full stack (daemon + code-server)
└── package.json              # npm workspaces root
```

## Architecture

Octopal uses a **central-daemon architecture**: `octopal serve` runs a Fastify + WebSocket server that owns a single `OctopalAgent`. The CLI, Discord bot, and VS Code extension are all clients that connect over WebSocket.

See the [wiki](wiki/) for detailed documentation:

| Page                                           | Description                                       |
| ---------------------------------------------- | ------------------------------------------------- |
| [Architecture](wiki/Architecture.md)           | System design, packages, data flow                |
| [Getting Started](wiki/Getting-Started.md)     | First-time setup walkthrough                      |
| [CLI Reference](wiki/CLI-Reference.md)         | All CLI commands and options                      |
| [Daemon and API](wiki/Daemon-and-API.md)       | REST endpoints and WebSocket protocol             |
| [Skills System](wiki/Skills-System.md)         | Writing and installing skills                     |
| [Connectors](wiki/Connectors.md)               | Discord, remote connectors, building your own     |
| [Docker Deployment](wiki/Docker-Deployment.md) | Container setup with docker-compose               |
| [Configuration](wiki/Configuration.md)         | config.toml reference and environment variables   |
| [Knowledge Base](wiki/Knowledge-Base.md)       | People, terms, and organizations                  |
| [Agent Tools](wiki/Agent-Tools.md)             | Built-in tool reference                           |
| [Contributing](wiki/Contributing.md)           | Development setup, adding tools/skills/connectors |

## Skills

Octopal is extensible via **skills** — directories containing a `SKILL.md` that inject domain-specific instructions into the agent's context.

**Three-tier skill resolution:**

1. **Bundled** (`builtin-skills/`) — shipped with Octopal (PARA, GitHub conventions, self-knowledge)
2. **Vault** (`<vault>/Meta/skills/`) — synced via git, editable in Obsidian
3. **Local** (`~/.octopal/skills/`) — user-installed, machine-specific

```bash
octopal skills list             # List all skills
octopal skills create my-skill  # → Creates ~/.octopal/skills/my-skill/SKILL.md
```

## Connectors

| Channel | Package                      | Status                         |
| ------- | ---------------------------- | ------------------------------ |
| CLI     | `@octopal/cli`               | ✅ Stable                      |
| Discord | `@octopal/connector-discord` | ✅ Working (DMs + threads)     |
| VS Code | `extensions/octopal-vscode`  | 🚧 Experimental                |
| Remote  | `@octopal/connector`         | ✅ Generic WebSocket connector |

## Vault Structure (PARA Method)

```
vault/
├── Projects/       # Active efforts with clear outcomes
├── Areas/          # Ongoing responsibilities (no end date)
├── Resources/      # Topics of interest, reference material
├── Archives/       # Completed/inactive items
├── Inbox/          # Raw notes before filing
├── Meta/           # Agent config, skills, schedules
└── Templates/      # Note templates for Obsidian
```

## Task Format

Tasks use the [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) emoji format:

```markdown
- [ ] Prepare project report ⏫ 🛫 2024-02-10 📅 2024-02-13 ➕ 2024-02-09
- [x] Review design mockups ✅ 2024-02-14
```

## License

MIT
