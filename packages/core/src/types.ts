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
}

export interface NoteMetadata {
  title: string;
  category: string;
  path: string;
  created?: string;
  modified?: string;
  tags?: string[];
}

