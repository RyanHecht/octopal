# Octopal — Copilot Instructions

This is the octopal codebase — a personal AI agent for PARA-method knowledge management.

## Key facts

- TypeScript monorepo using npm workspaces (Node 24+)
- Packages: `@octopal/core` (shared library), `@octopal/cli` (CLI entry point)
- AI engine: `@github/copilot-sdk` (vendored tarball in `vendor/`)
- Zod v4 for tool parameter schemas
- ESM modules (`"type": "module"`) — import paths must end in `.js`

## PARA vault

The vault is a **separate** Obsidian-compatible markdown repo. Octopal manages it via git operations.
- Structure: Projects/, Areas/, Resources/, Archives/, Inbox/, Templates/
- Tasks: Obsidian Tasks emoji format (`- [ ] Task ⏫ 📅 2024-01-15 ➕ 2024-01-08`)

## Building

```bash
npm run build         # Build all packages
npm run typecheck     # Type-check only
```

## Architecture

See ARCHITECTURE.md for detailed module documentation and extension guide.
