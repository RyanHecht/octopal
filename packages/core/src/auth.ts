import * as crypto from "node:crypto";

const SALT_ROUNDS = 10;
const TOKEN_ALGORITHM = "HS256";
const DEFAULT_TOKEN_EXPIRY = 365 * 24 * 60 * 60; // 1 year in seconds

export interface TokenPayload {
  /** Token ID */
  jti: string;
  /** Label for the token (e.g. "discord-bot") */
  sub: string;
  /** Allowed scopes */
  scopes: string[];
  /** Issued at (epoch seconds) */
  iat: number;
  /** Expires at (epoch seconds) */
  exp: number;
}

/** Hash a password using scrypt (pure Node, no native deps) */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

/** Verify a password against a stored hash */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(":");
  if (!salt || !key) return false;
  const derived = await scryptAsync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(key, "hex"), derived);
}

/** Generate a random 256-bit secret for signing tokens */
export function generateTokenSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Mint a JWT token */
export function mintToken(
  secret: string,
  options: { sub: string; scopes?: string[]; expiresIn?: number },
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    jti: crypto.randomUUID(),
    sub: options.sub,
    scopes: options.scopes ?? ["chat", "read"],
    iat: now,
    exp: now + (options.expiresIn ?? DEFAULT_TOKEN_EXPIRY),
  };
  return signJwt(payload, secret);
}

/** Verify and decode a JWT token. Throws on invalid/expired tokens. */
export function verifyToken(secret: string, token: string): TokenPayload {
  const payload = verifyJwt(token, secret);
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new Error("Token expired");
  }
  return payload;
}

// --- Minimal JWT implementation (HS256, no external deps) ---

function base64UrlEncode(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64url");
}

function base64UrlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

function signJwt(payload: TokenPayload, secret: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: TOKEN_ALGORITHM, typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest();
  return `${header}.${body}.${base64UrlEncode(signature)}`;
}

function verifyJwt(token: string, secret: string): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");

  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest();
  const actual = base64UrlDecode(sig);

  if (!crypto.timingSafeEqual(expected, actual)) {
    throw new Error("Invalid token signature");
  }

  return JSON.parse(base64UrlDecode(body).toString()) as TokenPayload;
}

function scryptAsync(password: string, salt: string, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}
