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

You have access to a web browser via the `scripts/browser.sh` wrapper around `playwright-cli`. Use it when you need to interact with websites beyond what `web_fetch` or `web_search` can do.

## When to Use the Browser

Use `scripts/browser.sh` instead of `web_fetch` when:
- A website **blocks agentic access** or returns bot-detection pages
- You need an **interactive flow** (login, form submission, multi-step navigation)
- The page requires **JavaScript rendering** (SPAs, dynamic content)
- You need a **screenshot** or **PDF** of a page
- You need to **persist login state** across multiple visits (cookies, sessions)
- You need to interact with page elements (click buttons, fill forms, select dropdowns)

Continue using `web_fetch` for simple page reads, API calls, and known-friendly sites.

## Core Workflow

The wrapper automatically uses a persistent profile so cookies and login state survive across sessions:

```bash
# 1. Open a page (persistent profile is automatic)
scripts/browser.sh open https://example.com

# 2. Take a snapshot to see page structure and element refs
scripts/browser.sh snapshot

# 3. Interact with the page using element refs from the snapshot
scripts/browser.sh click e15
scripts/browser.sh fill e22 "search query"
scripts/browser.sh press Enter

# 4. Take another snapshot to see the result
scripts/browser.sh snapshot

# 5. Screenshot if visual content is important
scripts/browser.sh screenshot

# 6. Close when done
scripts/browser.sh close
```

## Incognito Mode

Use `--incognito` for a temporary session with no saved state:

```bash
scripts/browser.sh --incognito open https://example.com
```

## Headed Mode

Use `--headed` to open a visible browser window (useful for debugging or showing the user):

```bash
scripts/browser.sh --headed open https://example.com
```

## Command Reference

All `playwright-cli` commands work through the wrapper. Pass the command and arguments after any wrapper flags (`--incognito`, `--headed`).

### Navigation
```bash
scripts/browser.sh open [url]              # open browser, optionally navigate
scripts/browser.sh goto <url>              # navigate to URL
scripts/browser.sh go-back                 # browser back button
scripts/browser.sh go-forward              # browser forward button
scripts/browser.sh reload                  # refresh page
```

### Page Interaction
```bash
scripts/browser.sh snapshot                # get page structure with element refs
scripts/browser.sh click <ref>             # click an element
scripts/browser.sh fill <ref> <text>       # clear and fill text into input
scripts/browser.sh type <text>             # type text (appends to focused element)
scripts/browser.sh select <ref> <value>    # select dropdown option
scripts/browser.sh check <ref>             # check a checkbox
scripts/browser.sh uncheck <ref>           # uncheck a checkbox
scripts/browser.sh hover <ref>             # hover over element
scripts/browser.sh press <key>             # press keyboard key (Enter, Tab, etc.)
scripts/browser.sh upload <file>           # upload file to file input
```

### Content Capture
```bash
scripts/browser.sh screenshot              # full page screenshot
scripts/browser.sh screenshot <ref>        # screenshot specific element
scripts/browser.sh pdf                     # save page as PDF
scripts/browser.sh eval <expression>       # run JavaScript, return result
```

### Tabs
```bash
scripts/browser.sh tab-list                # list all tabs
scripts/browser.sh tab-new [url]           # open new tab
scripts/browser.sh tab-select <index>      # switch to tab
scripts/browser.sh tab-close [index]       # close tab
```

### Storage & Cookies
```bash
scripts/browser.sh cookie-list             # list all cookies
scripts/browser.sh cookie-get <name>       # get specific cookie
scripts/browser.sh cookie-set <name> <val> # set a cookie
scripts/browser.sh cookie-clear            # clear all cookies
scripts/browser.sh state-save [file]       # save auth state to file
scripts/browser.sh state-load <file>       # restore auth state from file
```

### Session Management
```bash
scripts/browser.sh list                    # list all browser sessions
scripts/browser.sh close                   # close current session
scripts/browser.sh close-all               # close all sessions
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
- Use `eval` to extract specific data: `scripts/browser.sh eval "document.title"` or `scripts/browser.sh eval "document.querySelector('.price').textContent"`
