import WebSocket from "ws";
import { execFile } from "node:child_process";

/** Handler for a connector capability request */
export type CapabilityHandler = (
  action: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export interface RemoteConnectorOptions {
  /** Unique human-readable name for this connector (e.g. "work-mac") */
  name: string;
  /** WebSocket URL of the octopal daemon (e.g. "wss://octopal.example.com/ws") */
  daemonUrl: string;
  /** Auth token with connector scope */
  token: string;
  /** Capabilities this connector supports */
  capabilities: string[];
  /** Arbitrary metadata (OS, hostname, etc.) */
  metadata?: Record<string, unknown>;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
}

/**
 * Lightweight runtime for remote connectors.
 *
 * Connects to the octopal daemon via WebSocket, registers capabilities,
 * and dispatches incoming requests to registered handlers.
 */
export class OctopalRemoteConnector {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, CapabilityHandler>();
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private options: RemoteConnectorOptions) {}

  /** Register a handler for a capability */
  onRequest(capability: string, handler: CapabilityHandler): void {
    this.handlers.set(capability, handler);
  }

  /** Connect to the daemon and register */
  async connect(): Promise<void> {
    this.stopped = false;
    return this.doConnect();
  }

  /** Disconnect and stop reconnecting */
  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  /** Push a message proactively to the daemon */
  send(channelId: string, text: string, dataType?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to daemon");
    }
    this.ws.send(JSON.stringify({
      type: "connector.message",
      channelId,
      authorId: this.options.name,
      authorName: this.options.name,
      text,
      dataType,
    }));
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.options.daemonUrl}?token=${encodeURIComponent(this.options.token)}`;
      const ws = new WebSocket(url);
      let connected = false;

      ws.on("open", () => {
        // Register with the daemon
        ws.send(JSON.stringify({
          type: "connector.register",
          name: this.options.name,
          channelTypes: [],
          capabilities: this.options.capabilities,
          metadata: this.options.metadata ?? {},
        }));
      });

      ws.on("message", (data: Buffer | string) => {
        const msg = JSON.parse(typeof data === "string" ? data : data.toString());
        this.handleMessage(ws, msg, () => {
          if (!connected) {
            connected = true;
            this.reconnectDelay = 1000;
            resolve();
          }
        });
      });

      ws.on("close", () => {
        this.ws = null;
        if (!this.stopped) {
          console.log(`[connector:${this.options.name}] Disconnected, reconnecting in ${this.reconnectDelay}ms`);
          this.scheduleReconnect();
        }
        if (!connected) {
          reject(new Error("Connection closed before registration"));
        }
      });

      ws.on("error", (err) => {
        console.error(`[connector:${this.options.name}] WebSocket error:`, err.message);
        if (!connected) {
          reject(err);
        }
      });

      this.ws = ws;
    });
  }

  private handleMessage(ws: WebSocket, msg: any, onAck: () => void): void {
    switch (msg.type) {
      case "connector.ack":
        console.log(`[connector:${this.options.name}] Registered with daemon`);
        onAck();
        break;

      case "connector.request":
        this.handleRequest(ws, msg);
        break;

      case "error":
        console.error(`[connector:${this.options.name}] Daemon error: ${msg.error}`);
        break;
    }
  }

  private async handleRequest(ws: WebSocket, msg: {
    requestId: string;
    capability: string;
    action: string;
    params: Record<string, unknown>;
  }): Promise<void> {
    const handler = this.handlers.get(msg.capability);
    if (!handler) {
      ws.send(JSON.stringify({
        type: "connector.response",
        requestId: msg.requestId,
        error: `Unsupported capability: ${msg.capability}`,
      }));
      return;
    }

    try {
      const result = await handler(msg.action, msg.params);
      ws.send(JSON.stringify({
        type: "connector.response",
        requestId: msg.requestId,
        result,
      }));
    } catch (err) {
      ws.send(JSON.stringify({
        type: "connector.response",
        requestId: msg.requestId,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  private scheduleReconnect(): void {
    const autoReconnect = this.options.autoReconnect ?? true;
    if (!autoReconnect || this.stopped) return;

    const maxDelay = this.options.maxReconnectDelay ?? 30_000;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect().catch((err) => {
        console.error(`[connector:${this.options.name}] Reconnect failed:`, err.message);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, maxDelay);
        this.scheduleReconnect();
      });
    }, this.reconnectDelay);
  }
}

/**
 * Built-in shell capability handler.
 * Executes commands via the system shell and returns stdout/stderr/exitCode.
 */
export function shellHandler(options?: {
  /** Shell to use (default: /bin/sh on unix, cmd.exe on windows) */
  shell?: string;
  /** Default timeout in ms (default: 60000) */
  timeoutMs?: number;
}): CapabilityHandler {
  const defaultTimeout = options?.timeoutMs ?? 60_000;

  return async (action, params) => {
    if (action !== "execute") {
      throw new Error(`Unknown shell action: ${action}`);
    }

    const command = params.command as string;
    if (!command) throw new Error("command is required");

    const timeout = (params.timeoutMs as number) ?? defaultTimeout;
    const shell = options?.shell ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
    const shellFlag = process.platform === "win32" ? "/c" : "-c";

    return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      execFile(shell, [shellFlag, command], { timeout }, (err, stdout, stderr) => {
        const exitCode = err && "code" in err ? (err as any).code ?? 1 : err ? 1 : 0;
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: typeof exitCode === "number" ? exitCode : 1,
        });
      });
    });
  };
}
