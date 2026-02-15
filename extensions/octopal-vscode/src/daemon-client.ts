import * as vscode from "vscode";
import WebSocket from "ws";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface DaemonMessage {
  type: string;
  sessionId?: string;
  content?: string;
  text?: string;
  error?: string;
  tool?: string;
  args?: Record<string, unknown>;
  scopes?: string[];
}

type MessageHandler = (msg: DaemonMessage) => void;
type StateHandler = (state: ConnectionState) => void;

/**
 * WebSocket client for connecting to the Octopal daemon.
 * Handles authentication, reconnection, and message routing.
 */
export class DaemonClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private messageHandlers: MessageHandler[] = [];
  private stateHandlers: StateHandler[] = [];
  private _state: ConnectionState = "disconnected";
  private disposed = false;

  constructor(url: string) {
    this.url = url;
  }

  get state(): ConnectionState {
    return this._state;
  }

  onMessage(handler: MessageHandler): vscode.Disposable {
    this.messageHandlers.push(handler);
    return new vscode.Disposable(() => {
      const idx = this.messageHandlers.indexOf(handler);
      if (idx >= 0) this.messageHandlers.splice(idx, 1);
    });
  }

  onStateChange(handler: StateHandler): vscode.Disposable {
    this.stateHandlers.push(handler);
    return new vscode.Disposable(() => {
      const idx = this.stateHandlers.indexOf(handler);
      if (idx >= 0) this.stateHandlers.splice(idx, 1);
    });
  }

  private setState(state: ConnectionState) {
    this._state = state;
    for (const h of this.stateHandlers) h(state);
  }

  async connect(token: string): Promise<void> {
    this.token = token;
    this.disposed = false;
    return this.doConnect();
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.disposed) return reject(new Error("Client disposed"));

      this.setState("connecting");
      this.ws = new WebSocket(this.url);

      this.ws.on("open", () => {
        // Send auth message
        this.ws!.send(JSON.stringify({ type: "auth", token: this.token }));
      });

      let authenticated = false;

      this.ws.on("message", (data: Buffer | string) => {
        try {
          const msg: DaemonMessage = JSON.parse(
            typeof data === "string" ? data : data.toString(),
          );

          if (!authenticated) {
            if (msg.type === "auth.ok") {
              authenticated = true;
              this.setState("connected");
              this.reconnectDelay = 1000;
              resolve();
            } else if (msg.type === "auth.error") {
              this.setState("error");
              reject(new Error(msg.error ?? "Authentication failed"));
            }
            return;
          }

          for (const h of this.messageHandlers) h(msg);
        } catch {
          // Ignore parse errors
        }
      });

      this.ws.on("close", () => {
        if (this.disposed) return;
        this.setState("disconnected");
        this.scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        if (!authenticated) {
          this.setState("error");
          reject(err);
        }
      });
    });
  }

  private scheduleReconnect() {
    if (this.disposed || !this.token) return;
    this.reconnectTimer = setTimeout(() => {
      this.doConnect().catch(() => {
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay,
        );
      });
    }, this.reconnectDelay);
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
  }

  updateUrl(url: string): void {
    this.url = url;
  }
}
