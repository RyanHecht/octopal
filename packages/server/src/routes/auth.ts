import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
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

export function authRoutes(config: ResolvedConfig) {
  return async function (fastify: FastifyInstance) {
    // POST /auth/token — mint a new bearer token
    fastify.post("/token", async (request: FastifyRequest, reply: FastifyReply) => {
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
