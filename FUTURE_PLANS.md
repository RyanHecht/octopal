# Future Plans

Deferred items extracted from 20 Copilot CLI session plans, cross-referenced against the current codebase. Only unimplemented items are listed.

---

## 1. Security Hardening

### Content Boundaries / Prompt Injection Defense
- **What**: `sanitize.ts` module with `wrapUntrusted()`, `escapeYamlValue()`, `BOUNDARY_PROMPT_INSTRUCTIONS`. Wraps tool results and prompt injections in randomized boundary tags. System prompt hardening against embedded directives.
- **Blocks**: Defense-in-depth against prompt injection via vault content, web fetches, and connector messages
- **When needed**: Before open-sourcing or before adding external data sources (email, web ingestion)

### YAML Frontmatter Escaping in `save_knowledge`
- **What**: Replace string interpolation with proper YAML escaping for title/aliases in `save_knowledge()`
- **Blocks**: Prevents YAML injection via crafted knowledge entry titles/aliases

### scrypt Parameters Hardening
- **What**: Upgrade scrypt from Node defaults (`N=16384`) to OWASP minimum (`N=65536`)
- **Blocks**: Stronger password hashing against offline brute-force

### Git Credential Stripping
- **What**: Strip credentials from vault remote URLs before storing in config
- **Blocks**: Prevents accidental credential storage in `config.toml`

### ConnectorRegistry Pending Request Tracking
- **What**: Track which socket owns each pending request so disconnects only reject that connector's requests, not all pending requests
- **Blocks**: Correctness when multiple connectors are active simultaneously

### Auth Operation Logging
- **What**: Structured logging for failed logins, token minting, and token revocations
- **Blocks**: Security audit trail

---

## 2. Multi-Channel / Connectors

### Slack Connector
- **What**: Connector for monitoring Slack channels, extracting tasks and commitments from work conversations
- **Blocks**: Work conversation monitoring, commitment tracking from Slack
- **When needed**: After connector interface is stable

### Telegram Connector
- **What**: Connector for Telegram messaging
- **Blocks**: Mobile messaging interface to Octopal

### Web UI Connector
- **What**: Browser-based interaction with Octopal, real-time streaming activity panel
- **Blocks**: Non-terminal, non-Discord interaction; visual observability of agent activity

### Discord Voice Chat
- **What**: Voice-based interaction via `@discordjs/voice` + opus/sodium, STT/TTS services (Whisper, ElevenLabs)
- **Blocks**: Voice-based interaction with Octopal
- **When needed**: Dedicated phase — requires fundamentally different real-time session model

---

## 3. Scheduled Tasks & Proactive Behavior

### Skill-Declared Schedules (`metadata.schedules`)
- **What**: Skills declare scheduled tasks via `metadata.schedules` frontmatter in SKILL.md. A SkillScheduler scans skill files and registers their schedules automatically.
- **Blocks**: Proactive polling (Slack, GitHub issues), morning briefings, vault maintenance
- **Note**: The existing scheduler uses TOML files in `Meta/schedules/` and already works. This is a DX convenience — skills auto-register schedules instead of requiring separate TOML config. Nice-to-have, not blocking.

### Inbox System for Scheduled Task Results
- **What**: `~/.octopal/inbox/<skill>/` file-based inbox with JSON envelopes, `InboxProcessor`, `get_inbox` tool. Interface between fetcher scripts and the agent.
- **Blocks**: Structured agent interpretation of data from scheduled polls
- **Note**: Scheduled tasks can already write to vault notes directly. The inbox adds structured routing but isn't strictly required.

### Built-in Scheduled Skills (github-issues, commitments)
- **What**: `skill-github-issues` for proactive issue tracking, `skill-commitments` for commitment tracking with overdue alerts
- **Blocks**: Proactive GitHub issue tracking, commitment tracking

### `octopal catchup` CLI Command
- **What**: `octopal catchup [--source <name>]` — run fetchers now, process inbox, print summary
- **Blocks**: On-demand catch-up workflow
- **Note**: Without the inbox system, this reduces to "run all scheduled tasks now" — which can already be done via chat.

### `octopal schedules` CLI Command
- **What**: CLI command to list all scheduled tasks with status
- **Blocks**: Visibility into what's scheduled

### Task Failure Handling (Retry/Backoff)
- **What**: Retry with backoff for failed scheduled tasks (v1 just logs and continues)
- **When needed**: v2 of the scheduler

### Quiet Hours for Schedules
- **What**: Configurable quiet hours in `[schedules]` config to suppress proactive behavior
- **When needed**: v2 of the scheduler

---

## 4. Knowledge System Enhancements

### Scheduled Log Review / Reflection Tasks
- **What**: Periodic review of session logs to extract missed knowledge, identify patterns
- **When needed**: After SDK hooks are evaluated for effectiveness — "let's see how the hooks work first"

---

## 5. Subagent Dispatch & Background Tasks

### SDK Custom Agents for Skill Scoping
- **What**: Use SDK `customAgents` to create scoped agent personas with `tools: string[]` allowlists, so each agent only sees relevant tools/skills
- **When needed**: When skill count reaches ~50+ and causes context pollution (currently ~26 tools and 4 skills)

### Background Task Disk Persistence
- **What**: Persist background task state to disk for crash recovery
- **Blocks**: Background task survival across daemon restarts

### Background Task Workspaces
- **What**: Each background task gets its own isolated filesystem workspace (outside the vault) for scoped work like building software or accomplishing contained tasks. May or may not be version-controlled.
- **Blocks**: Scoped task execution that needs its own filesystem (builds, code generation, data processing)

---

## 6. Observability & Event Forwarding

### WebSocket Event Stream Forwarding (Full)
- **What**: Forward the full SDK `SessionEvent` stream over WebSocket for rendering in a web UI. Currently only `assistant.message_delta` is forwarded to WS clients (`ws.ts`); other events (intent, tool execution, turn lifecycle) are not exposed.
- **When needed**: When a web UI client exists
- **Blocks**: Rich client-side rendering of agent activity beyond text streaming

### Discord Background Task Notifications
- **What**: Send background task results to the originating Discord thread/DM when they complete
- **Blocks**: Users learning about completed background work in Discord

---

## 7. Session Management

### Session Persistence Across Daemon Restarts
- **What**: Persist session-to-channel mappings to a state file, use `resumeSession()` on daemon restart to restore active sessions
- **Blocks**: Session continuity across daemon restarts (currently all sessions are lost)
- **Note**: `SessionStore.sendOrRecover()` already recreates sessions on the fly when a message arrives for an expired session. The main loss is conversation history context, not functionality.

---

## 8. Deployment & Infrastructure

### Docker Support
- **What**: Dockerfile and docker-compose.yml for containerized deployment
- **Note**: Explicitly noted as out of scope for Phase 2, but design is container-friendly

---

## 9. Media & Rich Content

### Image Support
- **What**: Handle images in conversations (Copilot SDK supports image input)

### Audio Transcription
- **What**: Transcribe audio inputs via Copilot tools

### Document Handling
- **What**: Text extraction from documents (PDFs, etc.)

---

## 10. Configuration & DX

### `octopal skills create --scheduled` Scaffolding
- **What**: CLI scaffolding for creating skills with schedule metadata
- **When needed**: After skill-declared schedules are implemented

---

## Priority Tiers

### Tier 1 — Quick wins (small effort, clear value)
1. scrypt parameter upgrade (one-line change in `auth.ts`)
2. YAML frontmatter escaping in `save_knowledge`
3. Auth operation logging
4. Git credential stripping
5. `octopal schedules` CLI command (thin wrapper over existing `list_scheduled_tasks` tool)

### Tier 2 — Important when the time comes
6. Content boundaries / prompt injection defense (before external data sources)
7. ConnectorRegistry per-socket request tracking (before multiple connectors)
8. Full WebSocket event forwarding (before web UI)
9. Built-in scheduled skills (github-issues, commitments)
10. Docker support

### Tier 3 — Future features (need clear demand)
11. Slack/Telegram connectors
12. Web UI
13. Background task workspaces & disk persistence
14. Image/document handling
15. Session persistence across restarts
16. Discord background task notifications
