---
name: github
description: >
  GitHub workflow conventions for linking vault notes to GitHub issues, PRs,
  and repositories. Enriches knowledge entries with GitHub context.
metadata:
  author: octopal
  version: "0.1"
---

# GitHub Integration Conventions

When the user mentions GitHub issues, PRs, or repositories:

- Link them in notes using the format: `[org/repo#123](https://github.com/org/repo/issues/123)`
- When saving knowledge about a project, include its GitHub repo URL if known
- Extract issue/PR numbers from text and create links automatically
- For people known to have GitHub accounts, include their handle in knowledge entries

## Task Linking

When creating tasks related to GitHub issues:
- Include the issue link in the task description
- Example: `- [ ] Review PR [octopal#42](https://github.com/octopal/octopal/pull/42) ⏫ 📅 2024-01-15 ➕ 2024-01-08`
