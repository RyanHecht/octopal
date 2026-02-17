import { EventEmitter } from "node:events";

export type SourceType = "knowledge-match" | "vault-search" | "entity-detection";

export interface Source {
  type: SourceType;
  title: string;
  path?: string;
  snippet?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface TurnSourceEvents {
  source: [source: Source];
  cleared: [];
}

/**
 * Collects sources that informed the current turn.
 * Clear at the start of each new turn.
 */
export class TurnSourceCollector extends EventEmitter<TurnSourceEvents> {
  private _sources: Source[] = [];

  get sources(): readonly Source[] {
    return this._sources;
  }

  add(source: Source): void {
    this._sources.push(source);
    this.emit("source", source);
  }

  clear(): void {
    this._sources = [];
    this.emit("cleared");
  }
}
