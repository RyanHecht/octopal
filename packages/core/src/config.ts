import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as TOML from "smol-toml";

const OCTOPAL_DIR = process.env.OCTOPAL_HOME
  ? path.resolve(process.env.OCTOPAL_HOME)
  : path.join(os.homedir(), ".octopal");
const CONFIG_PATH = path.join(OCTOPAL_DIR, "config.toml");
const VAULT_DIR = path.join(OCTOPAL_DIR, "vault");

export interface ServerConfig {
  /** Port to listen on (default: 3847) */
  port?: number;
  /** bcrypt hash of the admin password */
  passwordHash?: string;
  /** Secret used to sign JWT tokens */
  tokenSecret?: string;
}

export interface SchedulerConfig {
  /** Whether the scheduler is enabled (default: true) */
  enabled?: boolean;
  /** Tick interval in seconds (default: 60) */
  tickIntervalSeconds?: number;
}

export interface DiscordConfig {
  /** Discord bot token */
  botToken: string;
  /** Discord user IDs allowed to message the bot */
  allowedUsers: string[];
  /** Channel IDs where the bot listens and responds (auto-threads) */
  channels?: string[];
}

export interface OctopalUserConfig {
  /** Git remote URL for the vault repo */
  vaultRemoteUrl?: string;
  /** Base URL for the web vault viewer (e.g., https://vault.example.com) */
  vaultBaseUrl?: string;
  /** Server configuration */
  server?: ServerConfig;
  /** Scheduler configuration */
  scheduler?: SchedulerConfig;
  /** Discord connector configuration */
  discord?: DiscordConfig;
}

/** Resolved config with all paths filled in */
export interface ResolvedConfig {
  configDir: string;
  configPath: string;
  vaultPath: string;
  vaultRemoteUrl?: string;
  vaultBaseUrl?: string;
  server: {
    port: number;
    passwordHash?: string;
    tokenSecret?: string;
  };
  scheduler: {
    enabled: boolean;
    tickIntervalSeconds: number;
  };
  discord?: DiscordConfig;
}

/** Commented config template written by `octopal init` */
export const CONFIG_TEMPLATE = `# Octopal configuration
# See: https://github.com/ryanhecht/octopal

# Git remote URL for your PARA vault
# vaultRemoteUrl = "https://github.com/youruser/octopal-vault.git"

# Base URL for the web vault viewer (code-server)
# When set, the agent formats note references as clickable links
# vaultBaseUrl = "https://vault.example.com"

[server]
# Port for the octopal daemon (default: 3847)
# port = 3847

# Set via: octopal serve --set-password
# passwordHash = ""

# Auto-generated on first login
# tokenSecret = ""

[scheduler]
# Whether the scheduler is enabled (default: true)
# enabled = true

# How often the scheduler checks for due tasks, in seconds (default: 60)
# tickIntervalSeconds = 60

[discord]
# Bot token for the Discord connector
# botToken = ""

# Discord user IDs allowed to interact with the bot
# allowedUsers = []

# Channel IDs where the bot listens and responds (creates threads automatically)
# channels = []
`;

export async function loadConfig(): Promise<ResolvedConfig> {
  const base: ResolvedConfig = {
    configDir: OCTOPAL_DIR,
    configPath: CONFIG_PATH,
    vaultPath: VAULT_DIR,
    server: {
      port: 3847,
    },
    scheduler: {
      enabled: true,
      tickIntervalSeconds: 60,
    },
  };

  // Environment overrides take precedence
  if (process.env.OCTOPAL_VAULT_PATH) {
    base.vaultPath = process.env.OCTOPAL_VAULT_PATH;
  }
  if (process.env.OCTOPAL_VAULT_REMOTE) {
    base.vaultRemoteUrl = process.env.OCTOPAL_VAULT_REMOTE;
  }
  if (process.env.OCTOPAL_VAULT_BASE_URL) {
    base.vaultBaseUrl = process.env.OCTOPAL_VAULT_BASE_URL;
  }
  if (process.env.OCTOPAL_SERVER_PORT) {
    base.server.port = parseInt(process.env.OCTOPAL_SERVER_PORT, 10);
  }
  if (process.env.OCTOPAL_PASSWORD_HASH) {
    base.server.passwordHash = process.env.OCTOPAL_PASSWORD_HASH;
  }
  if (process.env.OCTOPAL_TOKEN_SECRET) {
    base.server.tokenSecret = process.env.OCTOPAL_TOKEN_SECRET;
  }

  // Discord env var overrides
  const envBotToken = process.env.OCTOPAL_DISCORD_BOT_TOKEN;
  const envAllowedUsers = process.env.OCTOPAL_DISCORD_ALLOWED_USERS;
  const envChannels = process.env.OCTOPAL_DISCORD_CHANNELS;
  if (envBotToken) {
    base.discord = {
      botToken: envBotToken,
      allowedUsers: envAllowedUsers ? envAllowedUsers.split(",").map((s) => s.trim()) : [],
      channels: envChannels ? envChannels.split(",").map((s) => s.trim()) : [],
    };
  }

  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    const saved = TOML.parse(raw) as unknown as OctopalUserConfig;

    if (saved.vaultRemoteUrl) {
      base.vaultRemoteUrl ??= saved.vaultRemoteUrl;
    } else if ((saved as Record<string, unknown>).vaultRepo) {
      // Backward compat: old configs may have vaultRepo instead
      base.vaultRemoteUrl ??= `https://github.com/${(saved as Record<string, unknown>).vaultRepo}.git`;
    }
    if (saved.vaultBaseUrl) {
      base.vaultBaseUrl ??= saved.vaultBaseUrl;
    }
    if (saved.server) {
      base.server.port = saved.server.port ?? base.server.port;
      base.server.passwordHash = saved.server.passwordHash;
      base.server.tokenSecret = saved.server.tokenSecret;
    }
    if (saved.scheduler) {
      base.scheduler.enabled = saved.scheduler.enabled ?? base.scheduler.enabled;
      base.scheduler.tickIntervalSeconds = saved.scheduler.tickIntervalSeconds ?? base.scheduler.tickIntervalSeconds;
    }
    if (saved.discord) {
      base.discord ??= { botToken: saved.discord.botToken, allowedUsers: [], channels: [] };
      base.discord.botToken = base.discord.botToken || saved.discord.botToken;
      base.discord.allowedUsers = base.discord.allowedUsers.length
        ? base.discord.allowedUsers
        : saved.discord.allowedUsers ?? [];
      base.discord.channels = base.discord.channels?.length
        ? base.discord.channels
        : saved.discord.channels ?? [];
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // Parse error or unexpected failure — don't swallow it
      throw new Error(`Failed to load ${CONFIG_PATH}: ${err instanceof Error ? err.message : err}`);
    }
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
    existing = TOML.parse(raw) as unknown as OctopalUserConfig;
  } catch {
    // No existing config
  }

  const merged = { ...existing, ...config };
  // Deep-merge server config so setting one field doesn't wipe others
  if (existing.server || config.server) {
    merged.server = { ...existing.server, ...config.server };
  }
  await fs.writeFile(CONFIG_PATH, TOML.stringify(merged as Record<string, unknown>) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function isConfigured(config: ResolvedConfig): boolean {
  return !!config.vaultRemoteUrl;
}
