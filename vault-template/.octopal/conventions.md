# Vault Conventions

These conventions guide the Octopal agent when organizing your vault.
Edit any section to change how the agent behaves. The agent reads this
file before processing your input.

## File Structure

- Projects, Areas, and Resources use subdirectories with an `index.md` file
  (e.g., `Projects/my-project/index.md`)
- Inbox items are flat files (e.g., `Inbox/2024-01-15-quick-note.md`)
- Use lowercase-kebab-case for directory and file names

## Default Areas

These are common areas of responsibility. When content relates to one of
these topics and no matching area exists yet, create it:

- Work / Career
- Health & Fitness
- Finances
- Home & Household
- Relationships & Family
- Learning & Development

## Note Formatting

- Always include YAML frontmatter with: title, created, tags
- Use wikilinks for cross-references (e.g., `[[Project Name]]`)
- Keep notes concise but complete

## Task Defaults

- Always add a created date (➕) to every task
- Use medium priority (🔼) as the default when priority is unclear
- Include a due date (📅) when any deadline is mentioned or can be inferred

## Custom Instructions

Add any personal preferences or instructions for the agent here.
