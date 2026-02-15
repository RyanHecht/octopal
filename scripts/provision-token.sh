#!/bin/sh
# Provision a service token for code-server's Octopal extension.
# Called by the token-init container in docker-compose.
set -e

DAEMON_URL="${OCTOPAL_DAEMON_URL:-http://octopal:3847}"

if [ -z "$OCTOPAL_PASSWORD" ]; then
  echo "Error: OCTOPAL_PASSWORD is required" >&2
  exit 1
fi

echo "Provisioning service token from ${DAEMON_URL}..."

TOKEN=$(curl -sf "${DAEMON_URL}/auth/token" \
  -H 'Content-Type: application/json' \
  -d "{\"password\": \"${OCTOPAL_PASSWORD}\", \"label\": \"code-server\", \"scopes\": [\"chat\", \"read\"]}" \
  | jq -r '.token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "Error: Failed to mint service token" >&2
  exit 1
fi

echo "$TOKEN" > /shared/octopal-token
chmod 444 /shared/octopal-token
echo "Service token provisioned for code-server extension"
