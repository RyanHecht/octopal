export interface VaultConfig {
  /** Local path to the vault directory */
  localPath: string;
  /** Git remote URL for the vault repo */
  remoteUrl?: string;
}

export interface OctopalConfig {
  vault: VaultConfig;
  /** Base config directory (e.g. ~/.octopal) */
  configDir: string;
  /** Base URL for the web vault viewer, when available */
  vaultBaseUrl?: string;
  /** Absolute path to the vault inside the web viewer (e.g. /home/coder/vault) */
  vaultPathPrefix?: string;
}

export interface NoteMetadata {
  title: string;
  category: string;
  path: string;
  created?: string;
  modified?: string;
  tags?: string[];
}

/** Minimal interface for connector registry, used by agent tools without depending on server */
export interface ConnectorRegistryLike {
  list(): Array<{ name: string; capabilities: string[]; metadata: Record<string, unknown> }>;
  findByName(name: string): { name: string; capabilities: string[] } | undefined;
  sendRequest(
    connectorName: string,
    capability: string,
    action: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown>;
}

