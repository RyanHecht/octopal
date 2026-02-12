/** Inbound message from a channel (Discord, web, Telegram, etc.) */
export interface InboundMessage {
  /** Channel-specific conversation ID (e.g. Discord channel ID, Telegram chat ID) */
  channelId: string;
  /** Author identifier within the channel */
  authorId: string;
  /** Display name of the author */
  authorName: string;
  /** Message text content */
  text: string;
  /** Optional metadata (attachments, thread context, etc.) */
  metadata?: Record<string, unknown>;
}

/** Outbound response to send back to the channel */
export interface OutboundMessage {
  /** Channel-specific conversation ID to respond to */
  channelId: string;
  /** Response text content */
  text: string;
}

/**
 * Connector interface for channel integrations.
 *
 * A connector bridges an external messaging channel (Discord, Telegram, web, etc.)
 * to the Octopal daemon. Connectors are WebSocket clients that:
 * 1. Connect to the daemon and authenticate with a token
 * 2. Register themselves via `connector.register`
 * 3. Forward channel messages as `connector.message`
 * 4. Handle `connector.reply` to send responses back to the channel
 */
export interface OctopalConnector {
  /** Human-readable name of this connector (e.g. "discord", "web") */
  readonly name: string;

  /**
   * Connect to the daemon and start listening for channel events.
   * The connector authenticates with the provided token (must have `connector` scope).
   */
  connect(daemonUrl: string, token: string): Promise<void>;

  /** Gracefully disconnect from the daemon and clean up resources. */
  disconnect(): Promise<void>;
}
