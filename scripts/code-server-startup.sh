#!/bin/sh
# Startup script for Octopal's code-server container.
# Patches the PWA manifest so users who "install" it get an "Octopal" app,
# then launches code-server with the provided arguments.

set -e

# Patch the manifest.json served by code-server for PWA identity
MANIFEST_DIR="/home/coder/.local/share/code-server/manifest"
mkdir -p "$MANIFEST_DIR"
cat > "$MANIFEST_DIR/manifest.webmanifest" <<'MANIFEST'
{
  "name": "Octopal",
  "short_name": "Octopal",
  "description": "Personal AI knowledge vault",
  "start_url": ".",
  "display": "standalone",
  "theme_color": "#1a1a2e",
  "background_color": "#1a1a2e",
  "icons": [
    {
      "src": "./icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "./icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "./icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
MANIFEST

# Copy workspace settings template into vault if not present
VAULT_DIR="/home/coder/vault"
SETTINGS_DIR="$VAULT_DIR/.vscode"
if [ -d "$VAULT_DIR" ] && [ ! -f "$SETTINGS_DIR/settings.json" ]; then
  mkdir -p "$SETTINGS_DIR"
  cat > "$SETTINGS_DIR/settings.json" <<'SETTINGS'
{
  "editor.wordWrap": "on",
  "editor.minimap.enabled": false,
  "editor.fontSize": 15,
  "editor.lineHeight": 1.6,
  "markdown.preview.fontSize": 15,
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 2000,
  "foam.edit.linkStyle": "wikilink",
  "foam.openDailyNote.onStartup": false,
  "workbench.startupEditor": "readme"
}
SETTINGS
fi

# Launch code-server, forwarding all arguments
exec dumb-init code-server "$@"
