import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  verifyPassword,
  mintToken,
  verifyToken,
  generateTokenSecret,
  saveConfig,
  type TokenPayload,
  type ResolvedConfig,
} from "@octopal/core";

/** In-memory token registry for listing/revocation */
interface TokenRecord {
  jti: string;
  sub: string;
  scopes: string[];
  createdAt: number;
  expiresAt: number;
}

const issuedTokens = new Map<string, TokenRecord>();
const revokedTokens = new Set<string>();

/** Path to the persisted revocation list */
function revocationFilePath(config: ResolvedConfig): string {
  return path.join(config.configDir, "revoked-tokens.json");
}

/** Load revoked tokens from disk on startup */
export async function loadRevokedTokens(config: ResolvedConfig): Promise<void> {
  try {
    const data = await fs.readFile(revocationFilePath(config), "utf-8");
    const jtis = JSON.parse(data) as string[];
    for (const jti of jtis) revokedTokens.add(jti);
  } catch {
    // No file or parse error — start with empty set
  }
}

/** Persist revoked tokens to disk */
async function persistRevokedTokens(config: ResolvedConfig): Promise<void> {
  await fs.mkdir(config.configDir, { recursive: true });
  await fs.writeFile(
    revocationFilePath(config),
    JSON.stringify([...revokedTokens]),
    { encoding: "utf-8", mode: 0o600 },
  );
}

/** Simple per-IP rate limiter for auth endpoints */
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const AUTH_RATE_MAX = 10; // max attempts per window

function checkAuthRateLimit(ip: string): boolean {
  const now = Date.now();

  // Periodic cleanup: evict expired entries when map grows large
  if (authAttempts.size > 10_000) {
    for (const [key, entry] of authAttempts) {
      if (now > entry.resetAt) authAttempts.delete(key);
    }
  }

  const entry = authAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= AUTH_RATE_MAX;
}

export function authRoutes(config: ResolvedConfig) {
  return async function (fastify: FastifyInstance) {
    // POST /auth/token — mint a new bearer token
    fastify.post("/token", async (request: FastifyRequest, reply: FastifyReply) => {
      const clientIp = request.ip;
      if (!checkAuthRateLimit(clientIp)) {
        return reply.status(429).send({ error: "Too many authentication attempts. Try again later." });
      }

      const { password, label, scopes } = request.body as {
        password?: string;
        label?: string;
        scopes?: string[];
      };

      if (!password) {
        return reply.status(400).send({ error: "Password is required" });
      }
      if (!config.server.passwordHash) {
        return reply.status(500).send({ error: "Server password not configured" });
      }

      const valid = await verifyPassword(password, config.server.passwordHash);
      if (!valid) {
        return reply.status(401).send({ error: "Invalid password" });
      }

      // Ensure we have a token secret
      let tokenSecret = config.server.tokenSecret;
      if (!tokenSecret) {
        tokenSecret = generateTokenSecret();
        config.server.tokenSecret = tokenSecret;
        await saveConfig({ server: { tokenSecret } });
      }

      const token = mintToken(tokenSecret, {
        sub: label ?? "api-client",
        scopes: scopes ?? ["chat", "read"],
      });

      // Decode to get the jti for tracking
      const payload = verifyToken(tokenSecret, token);
      issuedTokens.set(payload.jti, {
        jti: payload.jti,
        sub: payload.sub,
        scopes: payload.scopes,
        createdAt: payload.iat * 1000,
        expiresAt: payload.exp * 1000,
      });

      return { token, jti: payload.jti };
    });

    // GET /auth/tokens — list issued tokens (admin only, requires password in header)
    fastify.get("/tokens", async (request: FastifyRequest, reply: FastifyReply) => {
      // Require bearer token with admin scope
      const payload = await requireAuth(request, reply, config, "admin");
      if (!payload) return;

      const tokens = Array.from(issuedTokens.values()).map((t) => ({
        ...t,
        revoked: revokedTokens.has(t.jti),
      }));
      return { tokens };
    });

    // DELETE /auth/token/:id — revoke a token
    fastify.delete("/token/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = await requireAuth(request, reply, config, "admin");
      if (!payload) return;

      const { id } = request.params as { id: string };
      if (!issuedTokens.has(id)) {
        return reply.status(404).send({ error: "Token not found" });
      }
      revokedTokens.add(id);
      await persistRevokedTokens(config);
      return { revoked: true, jti: id };
    });
  };
}

/** Verify bearer token and optionally check scope. Returns payload or sends 401. */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  config: ResolvedConfig,
  requiredScope?: string,
): Promise<TokenPayload | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.status(401).send({ error: "Authorization header required" });
    return null;
  }

  const token = authHeader.slice(7);
  if (!config.server.tokenSecret) {
    reply.status(500).send({ error: "Token secret not configured" });
    return null;
  }

  let payload: TokenPayload;
  try {
    payload = verifyToken(config.server.tokenSecret, token);
  } catch {
    reply.status(401).send({ error: "Invalid or expired token" });
    return null;
  }

  if (revokedTokens.has(payload.jti)) {
    reply.status(401).send({ error: "Token has been revoked" });
    return null;
  }

  if (requiredScope && !payload.scopes.includes(requiredScope)) {
    reply.status(403).send({ error: `Missing required scope: ${requiredScope}` });
    return null;
  }

  return payload;
}

/** Check if a token JTI is revoked */
export function isTokenRevoked(jti: string): boolean {
  return revokedTokens.has(jti);
}
