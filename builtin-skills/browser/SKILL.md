---
name: browser
description: >
  Web browser automation using playwright-cli. Enables navigating websites,
  interacting with pages, taking screenshots, extracting content, and managing
  persistent browser sessions with cookies and login state.
metadata:
  author: octopal
  version: "0.1"
---

# Browser Automation

You have access to a web browser via `playwright-cli`. Use it when you need to interact with websites beyond what `web_fetch` or `web_search` can do.

## When to Use the Browser

Use `playwright-cli` instead of `web_fetch` when:
- A website **blocks agentic access** or returns bot-detection pages
- You need an **interactive flow** (login, form submission, multi-step navigation)
- The page requires **JavaScript rendering** (SPAs, dynamic content)
- You need a **screenshot** or **PDF** of a page
- You need to **persist login state** across multiple visits (cookies, sessions)
- You need to interact with page elements (click buttons, fill forms, select dropdowns)

Continue using `web_fetch` for simple page reads, API calls, and known-friendly sites.

## Core Workflow

Always use the persistent profile so cookies and login state survive across sessions:

```bash
# 1. Open a page with persistent profile
playwright-cli open https://example.com --persistent --profile=~/.octopal/browser-profile

# 2. Take a snapshot to see page structure and element refs
playwright-cli snapshot

# 3. Interact with the page using element refs from the snapshot
playwright-cli click e15
playwright-cli fill e22 "search query"
playwright-cli press Enter

# 4. Take another snapshot to see the result
playwright-cli snapshot

# 5. Screenshot if visual content is important
playwright-cli screenshot

# 6. Close when done
playwright-cli close
```

## Named Sessions

Use `-s=NAME` to run multiple browser sessions in parallel:

```bash
playwright-cli -s=research open https://example.com --persistent --profile=~/.octopal/browser-profile
playwright-cli -s=shopping open https://store.com --persistent --profile=~/.octopal/browser-profile
playwright-cli list                    # see all active sessions
playwright-cli -s=research snapshot    # interact with specific session
```

## Incognito Mode

Omit `--persistent` for a temporary session with no saved state:

```bash
playwright-cli open https://example.com   # ephemeral — cookies lost on close
```

## Command Reference

### Navigation
```bash
playwright-cli open [url]              # open browser, optionally navigate
playwright-cli goto <url>              # navigate to URL
playwright-cli go-back                 # browser back button
playwright-cli go-forward              # browser forward button
playwright-cli reload                  # refresh page
```

### Page Interaction
```bash
playwright-cli snapshot                # get page structure with element refs
playwright-cli click <ref>             # click an element
playwright-cli fill <ref> <text>       # clear and fill text into input
playwright-cli type <text>             # type text (appends to focused element)
playwright-cli select <ref> <value>    # select dropdown option
playwright-cli check <ref>             # check a checkbox
playwright-cli uncheck <ref>           # uncheck a checkbox
playwright-cli hover <ref>             # hover over element
playwright-cli press <key>             # press keyboard key (Enter, Tab, etc.)
playwright-cli upload <file>           # upload file to file input
```

### Content Capture
```bash
playwright-cli screenshot              # full page screenshot
playwright-cli screenshot <ref>        # screenshot specific element
playwright-cli pdf                     # save page as PDF
playwright-cli eval <expression>       # run JavaScript, return result
```

### Tabs
```bash
playwright-cli tab-list                # list all tabs
playwright-cli tab-new [url]           # open new tab
playwright-cli tab-select <index>      # switch to tab
playwright-cli tab-close [index]       # close tab
```

### Storage & Cookies
```bash
playwright-cli cookie-list             # list all cookies
playwright-cli cookie-get <name>       # get specific cookie
playwright-cli cookie-set <name> <val> # set a cookie
playwright-cli cookie-clear            # clear all cookies
playwright-cli state-save [file]       # save auth state to file
playwright-cli state-load <file>       # restore auth state from file
```

### Session Management
```bash
playwright-cli list                    # list all browser sessions
playwright-cli close                   # close current session
playwright-cli close-all               # close all sessions
```

## Headed Mode

To see the browser window (useful for debugging or showing the user):

```bash
playwright-cli open https://example.com --headed --persistent --profile=~/.octopal/browser-profile
```

## Vault Integration

Use judgment about what's worth saving. Content that's directly relevant to an active project, area, or ongoing task is worth filing. Don't save every page you visit — save things the user is likely to want to reference again.

- **Save reference material** — If the user asks you to save an article, guide, or reference, use `write_note` to create a note in `Resources/` with a summary and the source URL.
- **Save knowledge entries** — Use `save_knowledge` only when you encounter a specific person, organization, or term that's relevant to the user's work and worth indexing for future recall. Don't create entries for every entity you encounter on a page.
- **Screenshots** — Take screenshots when the user asks, or when visual content is essential to the task (e.g., a chart, a UI state). Note the file path in your response.

## Tips

- Always `snapshot` after navigation or interaction to see the updated page state
- Element refs (like `e15`) come from snapshots — take a new snapshot to get current refs
- Use `fill` to replace input content; use `type` to append text
- For multi-step forms, snapshot between steps to track progress
- If a site blocks you, try using the browser with a persistent profile — logged-in sessions are less likely to be blocked
- Use `eval` to extract specific data: `playwright-cli eval "document.title"` or `playwright-cli eval "document.querySelector('.price').textContent"`
