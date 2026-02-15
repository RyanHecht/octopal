# Future Plans

Deferred items extracted from 20 Copilot CLI session plans, cross-referenced against the current codebase. Only unimplemented items are listed.

---

## 1. Security Hardening

### Content Boundaries / Prompt Injection Defense
- **What**: `sanitize.ts` module with `wrapUntrusted()`, `escapeYamlValue()`, `BOUNDARY_PROMPT_INSTRUCTIONS`. Wraps tool results and prompt injections in randomized boundary tags. System prompt hardening against embedded directives.
- **Source**: Security Hardening Plan: Prompt Injection & Input Sanitization
- **Blocks**: Defense-in-depth against prompt injection via vault content, web fetches, and connector messages
- **When needed**: Before open-sourcing or before adding external data sources (email, web ingestion)

### YAML Frontmatter Escaping in `save_knowledge`
- **What**: Replace string interpolation with proper YAML escaping for title/aliases in `save_knowledge()`
- **Source**: Security Hardening Plan
- **Blocks**: Prevents YAML injection via crafted knowledge entry titles/aliases

### Skill Loading Safety / Vault Skills Warning
- **What**: Log a warning if vault-level skills are present (supply-chain risk), document the trust boundary
- **Source**: Security Hardening Plan
- **Blocks**: Alerts users that vault skills in `Meta/skills/` are a trust boundary

### scrypt Parameters Hardening
- **What**: Upgrade scrypt from Node defaults (`N=16384`) to OWASP minimum (`N=65536`)
- **Source**: Octopal Security Audit (H6)
- **Blocks**: Stronger password hashing against offline brute-force

### Git Credential Stripping
- **What**: Strip credentials from vault remote URLs before storing in config
- **Source**: Octopal Security Audit (M4)
- **Blocks**: Prevents accidental credential storage in `config.toml`

### ConnectorRegistry Pending Request Tracking
- **What**: Track which socket owns each pending request so disconnects only reject that connector's requests, not all pending requests
- **Source**: Octopal Security Audit (L2)
- **Blocks**: Correctness when multiple connectors are active simultaneously

### Auth Operation Logging
- **What**: Structured logging for failed logins, token minting, and token revocations
- **Source**: Octopal Security Audit (L3)
- **Blocks**: Security audit trail

### Safety Rails for Remote Execution
- **What**: Allow/deny patterns and per-connector capability whitelists for remote command execution
- **Source**: Remote Connector Framework
- **When needed**: If remote shell is exposed beyond personal use

---

## 2. Multi-Channel / Connectors

### Slack Connector
- **What**: Connector for monitoring Slack channels, extracting tasks and commitments from work conversations
- **Source**: Octopal Implementation Plan, OpenClaw Comparison
- **Blocks**: Work conversation monitoring, commitment tracking from Slack
- **When needed**: After connector interface is stable

### Telegram Connector
- **What**: Connector for Telegram messaging
- **Source**: Octopal Implementation Plan, OpenClaw Comparison
- **Blocks**: Mobile messaging interface to Octopal

### Web UI Connector
- **What**: Browser-based interaction with Octopal, real-time streaming activity panel
- **Source**: Daemon Architecture, Subagent Dispatch Plan
- **Blocks**: Non-terminal, non-Discord interaction; visual observability of agent activity

### Discord Voice Chat
- **What**: Voice-based interaction via `@discordjs/voice` + opus/sodium, STT/TTS services (Whisper, ElevenLabs)
- **Source**: Plan: Discord Connector
- **Blocks**: Voice-based interaction with Octopal
- **When needed**: Dedicated phase — requires fundamentally different real-time session model

---

## 3. Scheduled Tasks & Proactive Behavior

### Skill-Declared Schedules (`metadata.schedules`)
- **What**: Skills declare scheduled tasks via `metadata.schedules` frontmatter in SKILL.md. A SkillScheduler scans skill files and registers their schedules automatically.
- **Source**: Skill Schedules — Proactive Octopal
- **Blocks**: Proactive polling (Slack, GitHub issues), morning briefings, vault maintenance — the entire "proactive agent" vision
- **Note**: The existing scheduler uses TOML files in `Meta/schedules/`. This is a second, complementary scheduling model.

### Inbox System for Scheduled Task Results
- **What**: `~/.octopal/inbox/<skill>/` file-based inbox with JSON envelopes, `InboxProcessor`, `get_inbox` tool. Interface between fetcher scripts and the agent.
- **Source**: Skill Schedules — Proactive Octopal
- **Blocks**: Agent interpretation of data from scheduled polls (Slack messages, GitHub issues)

### Built-in Scheduled Skills (github-issues, commitments)
- **What**: `skill-github-issues` for proactive issue tracking, `skill-commitments` for commitment tracking with overdue alerts
- **Source**: Skill Schedules — Proactive Octopal (Phase 3)
- **Blocks**: Proactive GitHub issue tracking, commitment tracking

### `octopal catchup` CLI Command
- **What**: `octopal catchup [--source <name>]` — run fetchers now, process inbox, print summary
- **Source**: Skill Schedules — Proactive Octopal (Phase 2)
- **Blocks**: On-demand catch-up workflow

### `octopal schedules` CLI Command
- **What**: CLI command to list all scheduled tasks with status
- **Source**: Skill Schedules — Proactive Octopal (Phase 2)
- **Blocks**: Visibility into what's scheduled

### Task Failure Handling (Retry/Backoff)
- **What**: Retry with backoff for failed scheduled tasks (v1 just logs and continues)
- **Source**: Skill Schedules — Proactive Octopal
- **When needed**: v2 of the scheduler

### Quiet Hours for Schedules
- **What**: Configurable quiet hours in `[schedules]` config to suppress proactive behavior
- **Source**: Skill Schedules — Proactive Octopal
- **When needed**: v2 of the scheduler

### Catchup Summary as Vault Note
- **What**: Write catchup summaries as vault notes (currently terminal-only)
- **Source**: Skill Schedules — Proactive Octopal
- **When needed**: After terminal-based catchup is validated

---

## 4. Knowledge System Enhancements

### Scheduled Log Review / Reflection Tasks
- **What**: Periodic review of session logs to extract missed knowledge, identify patterns
- **Source**: Agentic Knowledge Loop
- **When needed**: After SDK hooks are evaluated for effectiveness — "let's see how the hooks work first"

---

## 5. Subagent Dispatch & Background Tasks

### SDK Custom Agents for Skill Scoping
- **What**: Use SDK `customAgents` to create scoped agent personas with `tools: string[]` allowlists, so each agent only sees relevant tools/skills
- **Source**: Subagent Dispatch & Activity Observability, OpenClaw Comparison
- **When needed**: When skill count reaches ~50+ and causes context pollution (currently ~26 tools and 4 skills)

### Background Task Steering/Interrupt
- **What**: Ability to interrupt or redirect a running background task mid-execution
- **Source**: Subagent Dispatch (Phase 4: Polish)
- **Blocks**: Fine-grained control over long-running background work

### Background Task Disk Persistence
- **What**: Persist background task state to disk for crash recovery
- **Source**: Subagent Dispatch (Phase 4: Polish)
- **Blocks**: Background task survival across daemon restarts

### Background Task Workspaces
- **What**: Each background task gets its own isolated workspace directory
- **Source**: Subagent Dispatch (Phase 4: Polish)
- **Blocks**: Task isolation, prevents file conflicts between concurrent tasks

---

## 6. Observability & Event Forwarding

### WebSocket Event Stream Forwarding (Full)
- **What**: Forward the full SDK `SessionEvent` stream over WebSocket for rendering in a web UI. Currently only `assistant.message_delta` is forwarded to WS clients (`ws.ts`); other events (intent, tool execution, turn lifecycle) are not exposed.
- **Source**: Subagent Dispatch (Phase 4)
- **When needed**: When a web UI client exists
- **Blocks**: Rich client-side rendering of agent activity beyond text streaming

---

## 7. Session Management

### Session Persistence Across Daemon Restarts
- **What**: Persist session-to-channel mappings to a state file, use `resumeSession()` on daemon restart to restore active sessions
- **Source**: Daemon Architecture, OpenClaw Comparison (Phase 4/5)
- **Blocks**: Session continuity across daemon restarts (currently all sessions are lost)
- **Note**: `SessionStore` exists and session logs persist to vault, but no `resumeSession()` integration

---

## 8. Deployment & Infrastructure

### Docker Support
- **What**: Dockerfile and docker-compose.yml for containerized deployment
- **Source**: Phase 2: Persistent Server
- **Note**: Explicitly noted as out of scope for Phase 2, but design is container-friendly

### TLS Support
- **What**: Native TLS on the server process
- **Source**: Phase 2: Persistent Server
- **Note**: Explicitly deferred to reverse proxy layer (nginx, Caddy). Server runs plain HTTP by design.

---

## 9. Media & Rich Content

### Image Support
- **What**: Handle images in conversations (Copilot SDK supports image input)
- **Source**: Octopal Implementation Plan (Phase 2)

### Audio Transcription
- **What**: Transcribe audio inputs via Copilot tools
- **Source**: Octopal Implementation Plan (Phase 2)

### Document Handling
- **What**: Text extraction from documents (PDFs, etc.)
- **Source**: Octopal Implementation Plan (Phase 2)

---

## 10. Configuration & DX

### Config Hot-Reload
- **What**: Watch config file for changes and apply without restart
- **Source**: Octopal Implementation Plan (Phase 3)

### Multi-Agent Routing
- **What**: Route by user/channel to different agent configs, per-agent workspace isolation, agent-specific system prompts
- **Source**: Octopal Implementation Plan (Phase 3)
- **Blocks**: Multi-tenant or multi-persona deployments

### BYOK (Bring Your Own Key)
- **What**: Allow users to bring their own API keys for the Copilot SDK
- **Source**: Octopal Implementation Plan
- **When needed**: Phase 2 or later — SDK already supports BYOK

### `octopal skills create --scheduled` Scaffolding
- **What**: CLI scaffolding for creating skills with schedule metadata
- **Source**: Skill Schedules — Proactive Octopal (Phase 3)
- **When needed**: After skill-declared schedules are implemented

---

## Priority Tiers

### Tier 1 — Security (before open-sourcing)
1. Content boundaries / `sanitize.ts`
2. YAML frontmatter escaping
3. scrypt parameter upgrade
4. Git credential stripping

### Tier 2 — Core functionality gaps
5. Skill-declared schedules (`metadata.schedules`)
6. Inbox system for scheduled results
7. Session resume across restarts
8. ~~Discord background task notifications~~ *(done)*

### Tier 3 — Future features
9. Slack/Telegram connectors
10. Background task persistence/workspaces
11. Web UI
12. Media support (image/audio/document)
13. Config hot-reload
14. Multi-agent routing
