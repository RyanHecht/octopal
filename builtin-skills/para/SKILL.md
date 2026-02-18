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

1. Relevant knowledge context is **automatically provided** — matched knowledge entries, detected knowledge gaps, and related vault notes are injected before you see the message. Use this context to inform your processing.
2. Read the current vault structure to understand what projects/areas already exist
3. Create or update notes in the appropriate location, with wikilinks to knowledge entries
4. Extract actionable items and create tasks using Obsidian Tasks format
5. Save newly discovered people, organizations, or terms as knowledge entries using `save_knowledge`
6. For uncertain associations, use ⚠️ before the wikilink and call `add_triage_item`
7. Write a journal entry to `Resources/Knowledge/Journal/` documenting your decisions
8. **Always commit changes** to the vault when done — this is critical

For longer or pasted text that wasn't part of the original prompt, you can manually call `analyze_input` to run entity detection on it.

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

## Proactive Knowledge Capture

Create knowledge entries proactively when you encounter:
- **People** the user interacts with, works with, or mentions by name
- **Organizations** they work with, reference, or interact with
- **Systems/tools/products** that come up in their work with domain-specific relevance
- **Terms** with domain-specific meaning in the user's context

**Guardrails — do NOT create entries for:**
- Generic concepts everyone knows (email, meeting, calendar)
- Well-known platforms used generically (Google, Slack) unless the user has a specific relationship with them
- Passing mentions from web results that aren't relevant to the user's Areas or Projects
- Things too trivial or ephemeral to be useful in future interactions

## Search Before Creating

**Always check if an entity already exists before creating it.** The `save_knowledge` tool automatically checks for duplicates and will return existing content if a match is found. If it does, use `write_note` to update the existing entry with new information instead of creating a duplicate.

## Proactive Project Creation

When conversation reveals a multi-step effort with clear intent and actionable steps, create the project structure immediately:
- Create `Projects/{project-name}/index.md` with goal, context, and initial tasks
- Link to relevant knowledge entries
- Don't ask for permission — just do it and explain what you created

For vague ideas or casual mentions that aren't yet concrete, capture them as **Inbox notes** instead. Nothing should be lost. Suggest promoting Inbox items to Projects when they gain clarity in future interactions.

## Personal Context

Always check active projects and areas when responding. If the user mentions something that relates to a known project or area, reference it and file notes accordingly. Use what you know about the user to make connections they might not explicitly state.

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
