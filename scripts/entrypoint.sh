#!/bin/sh
# Entrypoint for the octopal daemon container.
# Sets permissive umask so vault files created by the daemon (clone, commit)
# are readable/writable by code-server's coder user (UID 1000).
set -e

umask 0000

# Fix permissions on existing vault files (from prior runs with restrictive umask)
VAULT_PATH="${OCTOPAL_VAULT_PATH:-/vault}"
if [ -d "$VAULT_PATH" ]; then
  chmod -R a+rwX "$VAULT_PATH" 2>/dev/null || true
fi

exec node packages/server/dist/index.js "$@"
