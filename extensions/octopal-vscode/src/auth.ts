import * as vscode from "vscode";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";

const TOKEN_KEY = "octopal.daemon.token";

/**
 * Manages authentication with the Octopal daemon.
 * Supports two modes:
 * - Docker mode: reads token from OCTOPAL_TOKEN_FILE
 * - External mode: user signs in with password, token stored in SecretStorage
 */
export class AuthManager {
  constructor(private secrets: vscode.SecretStorage) {}

  /**
   * Get a valid token. Tries Docker token file first, then SecretStorage.
   */
  async getToken(): Promise<string | undefined> {
    // Docker mode: check token file
    const tokenFile = process.env.OCTOPAL_TOKEN_FILE;
    if (tokenFile) {
      try {
        return fs.readFileSync(tokenFile, "utf-8").trim();
      } catch {
        // File not available — fall through to manual mode
      }
    }

    // External mode: stored token
    return this.secrets.get(TOKEN_KEY);
  }

  /**
   * Sign in by minting a token from the daemon.
   */
  async signIn(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration("octopal");
    const wsUrl = config.get<string>("daemonUrl", "ws://localhost:3847/ws");
    // Derive HTTP URL from WS URL
    const httpUrl = wsUrl
      .replace(/^ws:/, "http:")
      .replace(/^wss:/, "https:")
      .replace(/\/ws$/, "");

    const password = await vscode.window.showInputBox({
      prompt: "Enter your Octopal daemon password",
      password: true,
      ignoreFocusOut: true,
    });

    if (!password) return undefined;

    try {
      const token = await this.mintToken(httpUrl, password);
      await this.secrets.store(TOKEN_KEY, token);
      vscode.window.showInformationMessage("Octopal: Signed in successfully");
      return token;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Octopal: Sign in failed — ${msg}`);
      return undefined;
    }
  }

  async signOut(): Promise<void> {
    await this.secrets.delete(TOKEN_KEY);
    vscode.window.showInformationMessage("Octopal: Signed out");
  }

  get isDockerMode(): boolean {
    return !!process.env.OCTOPAL_TOKEN_FILE;
  }

  private mintToken(baseUrl: string, password: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        password,
        label: "vscode-extension",
        scopes: ["chat", "read"],
      });

      const url = new URL(`${baseUrl}/auth/token`);
      const mod = url.protocol === "https:" ? https : http;

      const req = mod.request(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                const { token } = JSON.parse(data);
                resolve(token);
              } catch {
                reject(new Error("Invalid response from daemon"));
              }
            } else {
              try {
                const { error } = JSON.parse(data);
                reject(new Error(error ?? `HTTP ${res.statusCode}`));
              } catch {
                reject(new Error(`HTTP ${res.statusCode}`));
              }
            }
          });
        },
      );

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}
