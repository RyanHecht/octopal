/**
 * Daemon WebSocket protocol message types.
 *
 * All messages are JSON with a `type` field. The protocol covers:
 * - auth: connection authentication
 * - chat: conversational messaging with streaming
 * - connector: channel integration registration and routing
 */

// ── Client → Daemon ──────────────────────────────────────────────

export interface AuthMessage {
  type: "auth";
  token: string;
}

export interface PingMessage {
  type: "ping";
}

export interface ChatSendMessage {
  type: "chat.send";
  /** Optional session ID to resume. Omit to use the default session for this connection. */
  sessionId?: string;
  text: string;
}

export interface ConnectorRegisterMessage {
  type: "connector.register";
  name: string;
  channelTypes: string[];
  /** Capabilities this connector supports (e.g. "shell", "screenshot") */
  capabilities?: string[];
  /** Arbitrary metadata about the connector (OS, hostname, etc.) */
  metadata?: Record<string, unknown>;
}

export interface ConnectorChannelMessage {
  type: "connector.message";
  channelId: string;
  authorId: string;
  authorName: string;
  text: string;
  /** Classification hint for proactive push (e.g. "transcript", "screenshot") */
  dataType?: string;
  metadata?: Record<string, unknown>;
}

/** Response from a connector to a daemon request */
export interface ConnectorResponseMessage {
  type: "connector.response";
  requestId: string;
  result?: unknown;
  error?: string;
}

/** Notify daemon that vault files were changed (e.g. by the user in code-server) */
export interface VaultFilesChangedMessage {
  type: "vault.files_changed";
  paths: string[];
}

export type ClientMessage =
  | AuthMessage
  | PingMessage
  | ChatSendMessage
  | ConnectorRegisterMessage
  | ConnectorChannelMessage
  | ConnectorResponseMessage
  | VaultFilesChangedMessage;

// ── Daemon → Client ──────────────────────────────────────────────

export interface AuthOkMessage {
  type: "auth.ok";
  scopes: string[];
}

export interface AuthErrorMessage {
  type: "auth.error";
  error: string;
}

export interface PongMessage {
  type: "pong";
}

export interface ChatDeltaMessage {
  type: "chat.delta";
  sessionId: string;
  content: string;
}

export interface ChatToolCallMessage {
  type: "chat.tool_call";
  sessionId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ChatCompleteMessage {
  type: "chat.complete";
  sessionId: string;
  text: string;
}

export interface ChatErrorMessage {
  type: "chat.error";
  sessionId: string;
  error: string;
}

export interface ConnectorAckMessage {
  type: "connector.ack";
  name: string;
}

/** Daemon requests an action from a connector */
export interface ConnectorRequestMessage {
  type: "connector.request";
  requestId: string;
  capability: string;
  action: string;
  params: Record<string, unknown>;
}

export interface ConnectorReplyMessage {
  type: "connector.reply";
  channelId: string;
  text: string;
}

export interface VaultCommittedMessage {
  type: "vault.committed";
  paths: string[];
}

export interface VaultErrorMessage {
  type: "vault.error";
  error: string;
}

export interface ErrorMessage {
  type: "error";
  error: string;
}

export type DaemonMessage =
  | AuthOkMessage
  | AuthErrorMessage
  | PongMessage
  | ChatDeltaMessage
  | ChatToolCallMessage
  | ChatCompleteMessage
  | ChatErrorMessage
  | ConnectorAckMessage
  | ConnectorRequestMessage
  | ConnectorReplyMessage
  | VaultCommittedMessage
  | VaultErrorMessage
  | ErrorMessage;

// ── Auth Scopes ──────────────────────────────────────────────────

export const SCOPES = ["read", "chat", "connector", "admin"] as const;
export type Scope = (typeof SCOPES)[number];
