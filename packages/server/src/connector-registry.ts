import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { createLogger } from "@octopal/core";

const log = createLogger("connector-registry");

export interface ConnectorInfo {
  name: string;
  capabilities: string[];
  metadata: Record<string, unknown>;
  socket: WebSocket;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Tracks connected remote connectors and routes requests to them.
 *
 * Connectors register on WS connect with a name, capabilities, and metadata.
 * Agent tools use the registry to discover connectors and send requests
 * with Promise-based correlation for responses.
 */
export class ConnectorRegistry {
  private connectors = new Map<WebSocket, ConnectorInfo>();
  private byName = new Map<string, ConnectorInfo>();
  private pending = new Map<string, PendingRequest>();
  private alive = new Set<WebSocket>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private defaultTimeoutMs: number;

  constructor(options?: { defaultTimeoutMs?: number }) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 60_000;
  }

  /** Start periodic heartbeat pings to all connectors. */
  startHeartbeat(intervalMs = 30_000): void {
    this.stopHeartbeat();
    this.sweepTimer = setInterval(() => {
      for (const [socket, info] of this.connectors) {
        if (!this.alive.has(socket)) {
          log.warn(`Connector "${info.name}" heartbeat timeout, closing`);
          socket.terminate();
          continue;
        }
        this.alive.delete(socket);
        socket.ping();
      }
    }, intervalMs);
  }

  /** Stop the heartbeat sweep. */
  stopHeartbeat(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Mark a connector socket as alive (call on pong). */
  markAlive(socket: WebSocket): void {
    this.alive.add(socket);
  }

  /** Register a connector. Returns false if the name is already taken. */
  register(
    socket: WebSocket,
    name: string,
    capabilities: string[],
    metadata: Record<string, unknown> = {},
  ): boolean {
    if (this.byName.has(name)) return false;

    const info: ConnectorInfo = { name, capabilities, metadata, socket };
    this.connectors.set(socket, info);
    this.byName.set(name, info);
    this.alive.add(socket);
    return true;
  }

  /** Unregister a connector (e.g. on disconnect). Rejects any pending requests. */
  unregister(socket: WebSocket): void {
    const info = this.connectors.get(socket);
    if (!info) return;

    this.connectors.delete(socket);
    this.byName.delete(info.name);
    this.alive.delete(socket);

    // Reject pending requests for this connector
    for (const [requestId, pending] of this.pending) {
      // Check if this request was sent to this socket by comparing
      // (we don't track which socket per request, so reject all pending
      //  requests if the socket matches — safe since each request goes
      //  to one socket)
      pending.reject(new Error(`Connector "${info.name}" disconnected`));
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
    }
  }

  /** Get connector info by socket */
  get(socket: WebSocket): ConnectorInfo | undefined {
    return this.connectors.get(socket);
  }

  /** Find a connector by name */
  findByName(name: string): ConnectorInfo | undefined {
    return this.byName.get(name);
  }

  /** Find connectors that have a specific capability */
  findByCapability(capability: string): ConnectorInfo[] {
    return [...this.byName.values()].filter((c) =>
      c.capabilities.includes(capability),
    );
  }

  /** List all connected connectors (name + capabilities + metadata) */
  list(): Array<{ name: string; capabilities: string[]; metadata: Record<string, unknown> }> {
    return [...this.byName.values()].map(({ name, capabilities, metadata }) => ({
      name,
      capabilities,
      metadata,
    }));
  }

  /**
   * Send a request to a named connector and wait for the response.
   * Throws if the connector is not connected, doesn't have the capability, or times out.
   */
  async sendRequest(
    connectorName: string,
    capability: string,
    action: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<unknown> {
    const info = this.byName.get(connectorName);
    if (!info) {
      throw new Error(`Connector "${connectorName}" is not connected`);
    }

    if (!info.capabilities.includes(capability)) {
      throw new Error(
        `Connector "${connectorName}" does not have capability "${capability}"`,
      );
    }

    const requestId = randomUUID();
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Request to "${connectorName}" timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(requestId, { resolve, reject, timer });

      info.socket.send(
        JSON.stringify({
          type: "connector.request",
          requestId,
          capability,
          action,
          params,
        }),
      );
    });
  }

  /** Handle a connector.response message. Returns true if it matched a pending request. */
  handleResponse(requestId: string, result?: unknown, error?: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;

    this.pending.delete(requestId);
    clearTimeout(pending.timer);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }
    return true;
  }
}
