import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const OCTOPAL_DIR = process.env.OCTOPAL_HOME
  ? path.resolve(process.env.OCTOPAL_HOME)
  : path.join(os.homedir(), ".octopal");
const CONFIG_PATH = path.join(OCTOPAL_DIR, "config.json");
const VAULT_DIR = path.join(OCTOPAL_DIR, "vault");

export interface ServerConfig {
  /** Port to listen on (default: 3847) */
  port?: number;
  /** bcrypt hash of the admin password */
  passwordHash?: string;
  /** Secret used to sign JWT tokens */
  tokenSecret?: string;
}

export interface OctopalUserConfig {
  /** GitHub repo in owner/name format (e.g. "ryan/vault") */
  vaultRepo?: string;
  /** Git remote URL — derived from vaultRepo if not set */
  vaultRemoteUrl?: string;
  /** Server configuration */
  server?: ServerConfig;
}

/** Resolved config with all paths filled in */
export interface ResolvedConfig {
  configDir: string;
  configPath: string;
  vaultPath: string;
  vaultRepo?: string;
  vaultRemoteUrl?: string;
  server: {
    port: number;
    passwordHash?: string;
    tokenSecret?: string;
  };
}

export async function loadConfig(): Promise<ResolvedConfig> {
  const base: ResolvedConfig = {
    configDir: OCTOPAL_DIR,
    configPath: CONFIG_PATH,
    vaultPath: VAULT_DIR,
    server: {
      port: 3847,
    },
  };

  // Environment overrides take precedence
  if (process.env.OCTOPAL_VAULT_PATH) {
    base.vaultPath = process.env.OCTOPAL_VAULT_PATH;
  }
  if (process.env.OCTOPAL_VAULT_REMOTE) {
    base.vaultRemoteUrl = process.env.OCTOPAL_VAULT_REMOTE;
  }
  if (process.env.OCTOPAL_SERVER_PORT) {
    base.server.port = parseInt(process.env.OCTOPAL_SERVER_PORT, 10);
  }

  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    const saved = JSON.parse(raw) as OctopalUserConfig;

    if (saved.vaultRepo) {
      base.vaultRepo = saved.vaultRepo;
      base.vaultRemoteUrl ??= `https://github.com/${saved.vaultRepo}.git`;
    }
    if (saved.vaultRemoteUrl) {
      base.vaultRemoteUrl ??= saved.vaultRemoteUrl;
    }
    if (saved.server) {
      base.server.port = saved.server.port ?? base.server.port;
      base.server.passwordHash = saved.server.passwordHash;
      base.server.tokenSecret = saved.server.tokenSecret;
    }
  } catch {
    // No config file yet — that's fine
  }

  return base;
}

export async function saveConfig(config: OctopalUserConfig): Promise<void> {
  await fs.mkdir(OCTOPAL_DIR, { recursive: true });

  // Merge with existing config
  let existing: OctopalUserConfig = {};
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    existing = JSON.parse(raw) as OctopalUserConfig;
  } catch {
    // No existing config
  }

  const merged = { ...existing, ...config };
  // Deep-merge server config so setting one field doesn't wipe others
  if (existing.server || config.server) {
    merged.server = { ...existing.server, ...config.server };
  }
  await fs.writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

export function isConfigured(config: ResolvedConfig): boolean {
  return !!config.vaultRepo || !!config.vaultRemoteUrl;
}
