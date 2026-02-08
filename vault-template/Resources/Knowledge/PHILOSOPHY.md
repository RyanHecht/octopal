# How Octopal Manages Knowledge

This document explains the philosophy behind how Octopal records, links,
and recalls knowledge. It's written for humans — both to explain the
system's behavior and to guide its future development.

## Core Principles

### 1. Knowledge Should Be Atomic

Each fact gets its own note. "Dr. Chen is my psychiatrist at Wellness
Partners" is one note — not a bullet point buried in a meeting log.
Atomic facts are findable, linkable, and independently editable.

### 2. Names Are Many, Entities Are One

People, places, and things get called by different names. "My shrink,"
"Dr. Chen," "the psychiatrist" — these are all the same person. The
knowledge system maintains an **alias list** for each entity so that
any reference can be resolved to the canonical entry, regardless of
how the user phrased it.

### 3. Links Are Made Eagerly, Corrected Lazily

When the agent sees a possible connection between input and a knowledge
entry, it **makes the link immediately** rather than waiting for
certainty. Confident links are clean; uncertain ones are prefixed with
⚠️ and queued for human review. A wrong link is easy to remove; a
missed connection is invisible and lost.

### 4. Recognition Before Recall

The system doesn't ask the agent to *remember* everything — it asks the
agent to *recognize* what's relevant. A two-phase preprocessor handles
this:

- **Phase 1 (deterministic):** Fast, free string matching against known
  titles and aliases. This catches every explicitly registered name.
- **Phase 2 (semantic):** A lightweight model identifies fuzzy matches
  and new entities. Backlink context from previous notes strengthens
  its confidence — if "the client" has appeared near Acme Corp links
  before, that pattern is visible.

This means the system gets smarter over time without growing the prompt:
new aliases make Phase 1 catch more, and new backlinks give Phase 2
better signal.

### 5. The Human Is the Final Authority

The agent proposes, the human disposes. High-confidence associations
are applied automatically (and can be undone). Low-confidence ones are
flagged with ⚠️ and queued in the triage doc. The human reviews at
their own pace — approving correct links, rejecting bad ones, and
refining aliases. Every approval teaches the system for next time.

### 6. Decisions Should Be Auditable

Every ingest produces a journal entry explaining what the agent did and
why. If a note was filed in the wrong project or a link was made
incorrectly, the user can trace the reasoning and correct the underlying
conventions or knowledge to prevent it from happening again.

## How Knowledge Flows

```
New Input
  → Preprocessor recognizes known entities (aliases + backlinks)
  → Agent files notes with [[wikilinks]] to knowledge entries
  → Agent creates new knowledge entries for unknown entities
  → Uncertain links get ⚠️ prefix + triage queue entry
  → Journal records what was done and why

User Triage (async)
  → User approves/rejects uncertain associations
  → Approved → alias added → deterministic match next time
  → Rejected → link removed → not suggested again

Over Time
  → Alias lists grow → more deterministic matches → less LLM guessing
  → Backlink graph grows → better semantic context → higher confidence
  → Journal history → agent can review past decisions for continuity
```

## Where Things Live

| What | Where | Why |
|------|-------|-----|
| Knowledge entries | `Resources/Knowledge/{People,Terms,Organizations}/` | Reference material belongs in PARA Resources |
| Agent journal | `Resources/Knowledge/Journal/` | Audit trail, searchable, linkable |
| Triage queue | `Inbox/Triage.md` | Raw items awaiting processing = Inbox |
| Agent conventions | `.octopal/conventions.md` | Meta-config, not content |

## Design Decisions

**Why aliases over backlinks for lookup?**
Aliases encode *identity* ("psychiatrist IS Dr. Chen"). Backlinks encode
*relevance* ("Dr. Chen was MENTIONED here"). For resolving references
in new input, you need identity. But backlinks provide valuable context
for semantic matching, so the preprocessor uses both.

**Why a two-phase preprocessor?**
Deterministic matching is fast, free, and reliable — it should handle
the majority of lookups. The semantic phase (LLM) handles the fuzzy
cases but is bounded to a single cheap call per ingest. This keeps
costs predictable and latency low.

**Why flag uncertain links instead of skipping them?**
A ⚠️ link is immediately useful — it works in Obsidian's graph view,
backlinks panel, and hover previews. The worst case is a wrong link the
user removes. The alternative — no link — means the connection is lost
and the user never knows it was possible.

**Why individual files instead of one big knowledge file?**
Each entry is independently editable, linkable, and searchable. The
system prompt stays constant-size regardless of how many entries exist.
Only relevant entries are loaded per ingest.
