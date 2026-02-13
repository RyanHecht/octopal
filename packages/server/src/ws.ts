import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { verifyToken, type TokenPayload, type ResolvedConfig, type OctopalAgent } from "@octopal/core";
import type { ClientMessage } from "./protocol.js";
import type { SessionStore } from "./sessions.js";
import type { ConnectorRegistry } from "./connector-registry.js";
import { isTokenRevoked } from "./routes/auth.js";

export function registerWebSocket(
  fastify: FastifyInstance,
  config: ResolvedConfig,
  agent: OctopalAgent,
  sessionStore: SessionStore,
  connectorRegistry: ConnectorRegistry,
) {

  fastify.get("/ws", { websocket: true }, (socket: WebSocket, request) => {
    let authenticated = false;
    let authPayload: TokenPayload | null = null;

    // Try to authenticate from query string
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const queryToken = url.searchParams.get("token");
    if (queryToken) {
      authPayload = tryAuth(queryToken, config);
      authenticated = authPayload !== null;
    }

    socket.on("message", (data: Buffer | string) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof data === "string" ? data : data.toString());
      } catch {
        socket.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
        return;
      }

      // Handle auth as first message if not yet authenticated
      if (!authenticated) {
        if (msg.type === "auth" && typeof msg.token === "string") {
          authPayload = tryAuth(msg.token, config);
          if (authPayload) {
            authenticated = true;
            socket.send(JSON.stringify({ type: "auth.ok", scopes: authPayload.scopes }));
          } else {
            socket.send(JSON.stringify({ type: "auth.error", error: "Invalid token" }));
            socket.close(4001, "Invalid token");
          }
          return;
        }
        socket.send(JSON.stringify({ type: "error", error: "Not authenticated" }));
        return;
      }

      switch (msg.type) {
        case "ping":
          socket.send(JSON.stringify({ type: "pong" }));
          break;

        case "chat.send":
          handleChatSend(socket, sessionStore, authPayload!, msg.sessionId, msg.text);
          break;

        case "connector.register":
          handleConnectorRegister(socket, connectorRegistry, authPayload!, msg.name, msg.channelTypes, msg.capabilities, msg.metadata);
          break;

        case "connector.message": {
          const reg = connectorRegistry.get(socket);
          if (!reg) {
            socket.send(JSON.stringify({ type: "error", error: "Not registered as a connector" }));
            return;
          }
          handleConnectorMessage(socket, sessionStore, reg.name, msg.channelId, msg.text);
          break;
        }

        case "connector.response": {
          connectorRegistry.handleResponse(msg.requestId, msg.result, msg.error);
          break;
        }

        default:
          socket.send(JSON.stringify({ type: "error", error: `Unknown message type: ${msg.type}` }));
      }
    });

    socket.on("close", () => {
      connectorRegistry.unregister(socket);
    });
  });
}

async function handleChatSend(
  socket: WebSocket,
  sessionStore: SessionStore,
  auth: TokenPayload,
  requestedSessionId: string | undefined,
  text: string,
) {
  if (!auth.scopes.includes("chat")) {
    socket.send(JSON.stringify({ type: "error", error: "Missing chat scope" }));
    return;
  }

  if (!text?.trim()) {
    socket.send(JSON.stringify({ type: "error", error: "text is required" }));
    return;
  }

  const sessionId = requestedSessionId ?? `cli-${auth.jti}`;

  try {
    const onEvent: import("@github/copilot-sdk").SessionEventHandler = (event) => {
      if (event.type === "assistant.message_delta" && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({
          type: "chat.delta",
          sessionId,
          content: event.data.deltaContent ?? "",
        }));
      }
    };

    const { response, recovered } = await sessionStore.sendOrRecover(sessionId, text.trim(), {
      onEvent,
    });

    if (recovered && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({
        type: "chat.session_recovered",
        sessionId,
      }));
    }

    const responseText = response?.data?.content ?? "";

    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({
        type: "chat.complete",
        sessionId,
        text: responseText,
      }));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({
        type: "chat.error",
        sessionId,
        error: message,
      }));
    }
  }
}

function handleConnectorRegister(
  socket: WebSocket,
  registry: ConnectorRegistry,
  auth: TokenPayload,
  name: string,
  channelTypes: string[],
  capabilities?: string[],
  metadata?: Record<string, unknown>,
) {
  if (!auth.scopes.includes("connector")) {
    socket.send(JSON.stringify({ type: "error", error: "Missing connector scope" }));
    return;
  }

  if (!name?.trim()) {
    socket.send(JSON.stringify({ type: "error", error: "name is required" }));
    return;
  }

  const registered = registry.register(
    socket,
    name.trim(),
    capabilities ?? [],
    metadata ?? {},
  );

  if (!registered) {
    socket.send(JSON.stringify({ type: "error", error: `Connector name "${name.trim()}" is already registered` }));
    return;
  }

  console.log(`[ws] Connector "${name.trim()}" registered with capabilities: [${(capabilities ?? []).join(", ")}]`);
  socket.send(JSON.stringify({ type: "connector.ack", name: name.trim() }));
}

async function handleConnectorMessage(
  socket: WebSocket,
  sessionStore: SessionStore,
  connectorName: string,
  channelId: string,
  text: string,
) {
  if (!channelId?.trim() || !text?.trim()) {
    socket.send(JSON.stringify({ type: "error", error: "channelId and text are required" }));
    return;
  }

  const sessionId = `${connectorName}-${channelId}`;

  try {
    const onEvent: import("@github/copilot-sdk").SessionEventHandler = (event) => {
      if (event.type === "assistant.message_delta" && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({
          type: "chat.delta",
          sessionId,
          content: event.data.deltaContent ?? "",
        }));
      }
    };

    const { response, recovered } = await sessionStore.sendOrRecover(sessionId, text.trim(), {
      onEvent,
    });

    if (recovered) {
      console.log(`[${connectorName}] Session ${sessionId} was recovered after expiry`);
    }

    const responseText = response?.data?.content ?? "";

    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({
        type: "connector.reply",
        channelId,
        text: responseText,
      }));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({
        type: "chat.error",
        sessionId,
        error: message,
      }));
    }
  }
}

function tryAuth(token: string, config: ResolvedConfig): TokenPayload | null {
  if (!config.server.tokenSecret) return null;
  try {
    const payload = verifyToken(config.server.tokenSecret, token);
    if (isTokenRevoked(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}
