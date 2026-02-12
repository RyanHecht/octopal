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
}

export interface ConnectorChannelMessage {
  type: "connector.message";
  channelId: string;
  authorId: string;
  authorName: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export type ClientMessage =
  | AuthMessage
  | PingMessage
  | ChatSendMessage
  | ConnectorRegisterMessage
  | ConnectorChannelMessage;

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

export interface ConnectorReplyMessage {
  type: "connector.reply";
  channelId: string;
  text: string;
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
  | ConnectorReplyMessage
  | ErrorMessage;

// ── Auth Scopes ──────────────────────────────────────────────────

export const SCOPES = ["read", "chat", "connector", "admin"] as const;
export type Scope = (typeof SCOPES)[number];
