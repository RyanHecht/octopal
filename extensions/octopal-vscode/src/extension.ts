import * as vscode from "vscode";
import { DaemonClient, type DaemonMessage, type ConnectionState } from "./daemon-client";
import { AuthManager } from "./auth";

let client: DaemonClient;
let authManager: AuthManager;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  authManager = new AuthManager(context.secrets);

  const config = vscode.workspace.getConfiguration("octopal");
  const daemonUrl =
    process.env.OCTOPAL_DAEMON_URL ??
    config.get<string>("daemonUrl", "ws://localhost:3847/ws");

  client = new DaemonClient(daemonUrl);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    0,
  );
  statusBarItem.command = "octopal.signIn";
  updateStatusBar("disconnected");
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    client.onStateChange((state) => updateStatusBar(state)),
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("octopal.signIn", async () => {
      const token = await authManager.signIn();
      if (token) await connectWithToken(token);
    }),
    vscode.commands.registerCommand("octopal.signOut", async () => {
      client.disconnect();
      await authManager.signOut();
    }),
  );

  // Register chat session controller for Agent HQ
  registerChatController(context);

  // Vault sync: watch for file saves and notify daemon
  registerVaultSync(context);

  // Auto-connect
  if (config.get<boolean>("autoConnect", true)) {
    const token = await authManager.getToken();
    if (token) {
      connectWithToken(token).catch(() => {
        if (!authManager.isDockerMode) {
          vscode.window
            .showWarningMessage(
              "Octopal: Could not connect to daemon",
              "Sign In",
            )
            .then((choice) => {
              if (choice === "Sign In") {
                vscode.commands.executeCommand("octopal.signIn");
              }
            });
        }
      });
    } else if (!authManager.isDockerMode) {
      vscode.window
        .showInformationMessage(
          "Octopal: Sign in to connect to your knowledge vault",
          "Sign In",
        )
        .then((choice) => {
          if (choice === "Sign In") {
            vscode.commands.executeCommand("octopal.signIn");
          }
        });
    }
  }
}

async function connectWithToken(token: string): Promise<void> {
  try {
    await client.connect(token);
  } catch (err) {
    updateStatusBar("error");
    throw err;
  }
}

function updateStatusBar(state: ConnectionState) {
  switch (state) {
    case "connected":
      statusBarItem.text = "$(octoface) Octopal";
      statusBarItem.tooltip = "Connected to Octopal daemon";
      statusBarItem.command = undefined;
      break;
    case "connecting":
      statusBarItem.text = "$(loading~spin) Octopal";
      statusBarItem.tooltip = "Connecting...";
      break;
    case "error":
      statusBarItem.text = "$(error) Octopal";
      statusBarItem.tooltip = "Connection error — click to sign in";
      statusBarItem.command = "octopal.signIn";
      break;
    default:
      statusBarItem.text = "$(circle-outline) Octopal";
      statusBarItem.tooltip = "Disconnected — click to sign in";
      statusBarItem.command = "octopal.signIn";
  }
}

/**
 * Register the ChatSessionItemController for the Agent HQ panel.
 * Uses the chatSessionsProvider proposed API (version 3).
 */
function registerChatController(context: vscode.ExtensionContext) {
  // Guard: proposed API may not be available
  if (!vscode.chat?.createChatSessionItemController) {
    console.warn(
      "[octopal] chatSessionsProvider API not available — skipping Agent HQ registration",
    );
    return;
  }

  const controller = vscode.chat.createChatSessionItemController(
    "octopal",
    async (_token: vscode.CancellationToken) => {
      // On refresh, populate with a default session
      const sessionUri = vscode.Uri.parse("octopal:session/default");
      const item = controller.createChatSessionItem(sessionUri, "Octopal Chat");
      item.description = "Personal knowledge assistant";
      item.status = vscode.ChatSessionStatus.Completed;
      controller.items.replace([item]);
    },
  );

  context.subscriptions.push(controller);

  // Register content provider for rendering chat sessions
  if (vscode.chat.registerChatSessionContentProvider) {
    // Create a chat participant for the content provider
    const participant = vscode.chat.createChatParticipant(
      "octopal.chat",
      handleChatRequest,
    );
    participant.iconPath = vscode.Uri.joinPath(
      context.extensionUri,
      "icon.png",
    );

    const contentProvider: vscode.ChatSessionContentProvider = {
      provideChatSessionContent(
        _resource: vscode.Uri,
        _token: vscode.CancellationToken,
      ): vscode.ChatSession {
        return {
          history: [],
          requestHandler: handleChatRequest,
        };
      },
    };

    context.subscriptions.push(
      vscode.chat.registerChatSessionContentProvider(
        "octopal",
        contentProvider,
        participant,
      ),
      participant,
    );
  }
}

/**
 * Handle chat requests from the VS Code chat UI.
 * Sends the message to the daemon and streams the response.
 */
const handleChatRequest: vscode.ChatRequestHandler = async (
  request,
  _context,
  stream,
  token,
) => {
  if (client.state !== "connected") {
    stream.markdown(
      "⚠️ Not connected to the Octopal daemon. Use the status bar to sign in.",
    );
    return;
  }

  const sessionId = `vscode-${Date.now()}`;
  const text = request.prompt;

  // Set up response listener
  const responseComplete = new Promise<void>((resolve, reject) => {
    const handler = client.onMessage((msg: DaemonMessage) => {
      if (msg.sessionId !== sessionId) return;

      switch (msg.type) {
        case "chat.delta":
          if (msg.content) stream.markdown(msg.content);
          break;
        case "chat.complete":
          handler.dispose();
          resolve();
          break;
        case "chat.error":
          handler.dispose();
          reject(new Error(msg.error ?? "Chat error"));
          break;
      }
    });

    token.onCancellationRequested(() => {
      handler.dispose();
      resolve();
    });
  });

  // Send the message
  client.send({ type: "chat.send", sessionId, text });

  await responseComplete;
};

/**
 * Watch for file saves in the vault workspace and notify the daemon.
 * The daemon owns git operations — it will commit and push user edits.
 */
function registerVaultSync(context: vscode.ExtensionContext) {
  // Debounce: collect changed paths and send after a delay
  let pendingPaths: Set<string> = new Set();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (client.state !== "connected") return;
      if (!doc.uri.scheme === undefined) return;

      // Get relative path within workspace
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;

      const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
      if (!relativePath || relativePath === doc.uri.fsPath) return;

      // Only track markdown and common vault files
      if (
        !relativePath.endsWith(".md") &&
        !relativePath.endsWith(".toml") &&
        !relativePath.endsWith(".json")
      ) {
        return;
      }

      pendingPaths.add(relativePath);

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (pendingPaths.size > 0 && client.state === "connected") {
          client.send({
            type: "vault.files_changed",
            paths: [...pendingPaths],
          });
          pendingPaths = new Set();
        }
      }, 2000);
    }),
  );
}

export function deactivate() {
  client?.disconnect();
}
