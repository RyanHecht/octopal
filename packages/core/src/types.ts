export interface VaultConfig {
  /** Local path to the vault directory */
  localPath: string;
  /** Git remote URL for the vault repo */
  remoteUrl?: string;
}

export interface OctopalConfig {
  vault: VaultConfig;
}

export interface NoteMetadata {
  title: string;
  category: string;
  path: string;
  created?: string;
  modified?: string;
  tags?: string[];
}

export interface IngestResult {
  /** Notes created or updated */
  notes: string[];
  /** Tasks created */
  tasks: string[];
  /** Summary of what the agent did */
  summary: string;
}
