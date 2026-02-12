/**
 * CLI client for the Octopal daemon.
 * Connects via native WebSocket (Node 24+), authenticates, and provides a chat interface.
 */
export class DaemonClient {
  private ws: WebSocket | null = null;
  private authenticated = false;

  constructor(
    private daemonUrl: string,
    private token: string,
  ) {}

  /** Try to connect to the daemon. Returns true if connected and authenticated. */
  async connect(timeoutMs = 2000): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.ws?.close();
        resolve(false);
      }, timeoutMs);

      try {
        this.ws = new WebSocket(`${this.daemonUrl}?token=${encodeURIComponent(this.token)}`);
      } catch {
        clearTimeout(timer);
        resolve(false);
        return;
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.type === "auth.ok") {
            clearTimeout(timer);
            this.authenticated = true;
            resolve(true);
          } else if (msg.type === "auth.error") {
            clearTimeout(timer);
            resolve(false);
          }
        } catch {
          // Ignore parse errors during auth
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
  }

  /**
   * Send a chat message and stream the response.
   * Returns the complete response text.
   */
  async chat(
    text: string,
    options?: {
      sessionId?: string;
      onDelta?: (content: string) => void;
    },
  ): Promise<string> {
    if (!this.ws || !this.authenticated) {
      throw new Error("Not connected to daemon");
    }

    return new Promise((resolve, reject) => {
      const prevHandler = this.ws!.onmessage;

      this.ws!.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          switch (msg.type) {
            case "chat.delta":
              options?.onDelta?.(msg.content);
              break;
            case "chat.complete":
              this.ws!.onmessage = prevHandler;
              resolve(msg.text);
              break;
            case "chat.error":
              this.ws!.onmessage = prevHandler;
              reject(new Error(msg.error));
              break;
          }
        } catch {
          // Ignore parse errors
        }
      };

      this.ws!.send(JSON.stringify({
        type: "chat.send",
        sessionId: options?.sessionId,
        text,
      }));
    });
  }

  /** Disconnect from the daemon */
  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.authenticated = false;
  }
}

/** Try connecting to a running daemon. Returns a client if successful, null otherwise. */
export async function tryConnectDaemon(port: number, token: string): Promise<DaemonClient | null> {
  const client = new DaemonClient(`ws://127.0.0.1:${port}/ws`, token);
  const connected = await client.connect();
  if (connected) return client;
  client.disconnect();
  return null;
}
