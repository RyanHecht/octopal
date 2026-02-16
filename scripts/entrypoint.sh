#!/bin/sh
# Entrypoint for the octopal daemon container.
# Sets permissive umask so vault files created by the daemon (clone, commit)
# are readable/writable by code-server's coder user (UID 1000).
set -e

umask 0000

# Configure git credential helper using the container's gh CLI
git config --global credential.helper '!gh auth git-credential'

# Set git identity from env vars, falling back to gh API
if [ -n "$GIT_USER_NAME" ]; then
  git config --global user.name "$GIT_USER_NAME"
elif [ -n "$GH_TOKEN" ]; then
  name=$(gh api user --jq .name 2>/dev/null || echo "")
  [ -n "$name" ] && git config --global user.name "$name"
fi
if [ -n "$GIT_USER_EMAIL" ]; then
  git config --global user.email "$GIT_USER_EMAIL"
elif [ -n "$GH_TOKEN" ]; then
  email=$(gh api user --jq .email 2>/dev/null || echo "")
  if [ -n "$email" ] && [ "$email" != "null" ]; then
    git config --global user.email "$email"
  else
    # Use GitHub noreply address
    id=$(gh api user --jq .id 2>/dev/null || echo "")
    login=$(gh api user --jq .login 2>/dev/null || echo "octopal")
    [ -n "$id" ] && git config --global user.email "${id}+${login}@users.noreply.github.com"
  fi
fi

# Fix permissions on existing vault files (from prior runs with restrictive umask)
VAULT_PATH="${OCTOPAL_VAULT_PATH:-/vault}"
if [ -d "$VAULT_PATH" ]; then
  chmod -R a+rwX "$VAULT_PATH" 2>/dev/null || true
fi

exec node packages/server/dist/index.js "$@"
