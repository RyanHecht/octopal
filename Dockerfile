# --- Build stage ---
FROM node:24-alpine AS builder
WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/server/package.json packages/server/
COPY packages/connector/package.json packages/connector/
COPY packages/connector-discord/package.json packages/connector-discord/
RUN npm ci

# Copy source and build
COPY tsconfig.json tsconfig.base.json ./
COPY packages/ packages/
RUN npm run build

# --- QMD stage (cached independently) ---
FROM node:24-alpine AS qmd-builder
RUN apk add --no-cache python3 make g++ bash curl
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"
RUN bun install -g https://github.com/tobi/qmd

# --- Runtime stage ---
FROM node:24-alpine
RUN apk add --no-cache git curl jq bash

# Install GitHub CLI
RUN curl -fsSL https://github.com/cli/cli/releases/latest/download/gh_$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | jq -r '.tag_name | ltrimstr("v")')_linux_amd64.tar.gz \
    | tar xz --strip-components=1 -C /usr/local

# Git credential helper is configured at runtime by entrypoint.sh

# Copy QMD from its build stage (avoids rebuilding native deps every time)
COPY --from=qmd-builder /root/.bun /root/.bun
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app

# Copy built output and dependencies
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/packages/core/dist packages/core/dist/
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/cli/dist packages/cli/dist/
COPY --from=builder /app/packages/cli/package.json packages/cli/
COPY --from=builder /app/packages/server/dist packages/server/dist/
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/connector/dist packages/connector/dist/
COPY --from=builder /app/packages/connector/package.json packages/connector/
COPY --from=builder /app/packages/connector-discord/dist packages/connector-discord/dist/
COPY --from=builder /app/packages/connector-discord/package.json packages/connector-discord/
COPY --from=builder /app/package.json package.json

# Copy static assets
COPY builtin-skills/ builtin-skills/
COPY vault-template/ vault-template/

# Token provisioning script
COPY scripts/ scripts/
RUN chmod +x scripts/*.sh 2>/dev/null || true

EXPOSE 3847
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
