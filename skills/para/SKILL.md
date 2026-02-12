---
name: para
description: >
  PARA method vault organization. Defines how notes, tasks, and knowledge entries
  are structured in the vault using the Projects/Areas/Resources/Archives framework.
metadata:
  author: octopal
  version: "0.1"
---

# PARA Vault Organization

This skill defines how the knowledge vault is organized using the PARA method.

## The PARA Method

- **Projects**: Active efforts with a clear outcome and deadline (e.g., "Launch website", "Plan vacation")
- **Areas**: Ongoing responsibilities with no end date (e.g., "Health", "Finances", "Career")
- **Resources**: Topics of interest or reference material (e.g., "TypeScript", "Recipes", "Book notes")
- **Archives**: Completed or inactive items from the above categories

## Ingestion Workflow

When processing notes, brain dumps, transcripts, or other raw input:

1. **Call `analyze_input` first** with the raw text to identify relevant knowledge context, uncertain associations, and new entities
2. Read the current vault structure to understand what projects/areas already exist
3. Use the analysis results to inform your processing — reference matched knowledge, handle triage items, create new entity entries
4. Create or update notes in the appropriate location, with wikilinks to knowledge entries
5. Extract actionable items and create tasks using Obsidian Tasks format
6. Save newly discovered people, organizations, or terms as knowledge entries using `save_knowledge`
7. For uncertain associations, use ⚠️ before the wikilink and call `add_triage_item`
8. Write a journal entry to `Resources/Knowledge/Journal/` documenting your decisions
9. **Always commit changes** to the vault when done — this is critical

## Knowledge Links

- Confirmed links: `[[Knowledge/People/Sarah|Sarah]]`
- Uncertain links: `⚠️[[Knowledge/People/Dr. Chen|my shrink]]`
- The ⚠️ prefix means "pending user review" — make the link anyway so it's useful immediately

## Obsidian Tasks Format

Create tasks using this emoji format:
- `- [ ] Task description ⏫ 📅 2024-01-15 ➕ 2024-01-08`
- Priority emojis: 🔺 (highest), ⏫ (high), 🔼 (medium), 🔽 (low), ⏬ (lowest)
- Date emojis: 📅 (due), 🛫 (start), ⏳ (scheduled), ➕ (created), ✅ (done)

## Note Formatting Guidelines

- Use Obsidian-compatible markdown (wikilinks like `[[Note Name]]` are fine)
- Add YAML frontmatter to new notes (title, created date, tags)
- Use kebab-case for filenames (e.g., `project-kickoff-notes.md`)
- Keep notes concise but complete
- When unsure where something belongs, put it in the Inbox
- Always include a created date (➕) on tasks
- Prefer creating notes in existing projects/areas when relevant

## Knowledge Entries

Knowledge entries live in `Resources/Knowledge/{People,Terms,Organizations}/` and use this format:

```markdown
---
title: "Dr. Chen"
aliases: [psychiatrist, Dr. C, my psychiatrist]
category: people
created: 2024-01-15
---

Psychiatrist at Wellness Partners.
- Phone: 555-0123
```

Use `save_knowledge` to create these entries. The `aliases` field enables automatic recognition on future interactions.
