# Knowledge Base

This directory is a wiki of atomic facts that Octopal uses to understand
your world. Each entry is an Obsidian-compatible note that the agent reads
when processing your input.

## How It Works

When you ingest notes, Octopal:
1. Scans this directory for known people, terms, and organizations
2. Matches them against your input (by title and aliases)
3. Uses matched entries as context when filing your notes
4. Creates new entries when it discovers new entities
5. Links your notes to relevant knowledge entries with `[[wikilinks]]`

## Entry Format

Each entry uses YAML frontmatter with `title` and `aliases`:

```markdown
---
title: Dr. Chen
aliases: [psychiatrist, Dr. C, my psychiatrist]
category: people
created: 2026-02-08
---

Psychiatrist at Wellness Partners.
- Phone: 555-0123
- Website: wellnesspartners.com
```

The `aliases` field is key — it lets the agent recognize different ways
you refer to the same thing ("my shrink" → Dr. Chen).

## Directories

- **People/** — Contacts, colleagues, family, professionals
- **Terms/** — Jargon, nicknames, shorthand, recurring concepts
- **Organizations/** — Companies, teams, institutions, practices
- **Journal/** — Agent decision logs (auto-generated per ingest)

## Editing

Edit any entry freely in Obsidian. Add aliases, update details, or
delete entries you don't need. Changes take effect on the next ingest.

## Philosophy

See [[PHILOSOPHY]] for the design principles behind this system —
why aliases over backlinks, why eager linking, and how the system
learns over time.
