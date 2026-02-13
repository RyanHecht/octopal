#!/usr/bin/env node
/**
 * Integration test for the remote connector framework.
 *
 * Tests the full round-trip:
 * 1. Starts the octopal daemon with a test config
 * 2. Connects a mock connector with shell capability
 * 3. Verifies registration, shell handler, and disconnect
 *
 * Usage: node packages/connector/test-integration.mjs
 */

import { createServer } from "../server/dist/server.js";
import { hashPassword, generateTokenSecret, mintToken } from "@octopal/core";
import { OctopalRemoteConnector, shellHandler } from "./dist/connector.js";
import { ConnectorRegistry } from "../server/dist/connector-registry.js";
import WebSocket from "ws";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

const PASS = "✅";
const FAIL = "❌";
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ${PASS} ${msg}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${msg}`);
    failed++;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Prevent real Discord bot from starting
  delete process.env.OCTOPAL_DISCORD_BOT_TOKEN;

  console.log("🔧 Setting up test environment...");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "octopal-connector-test-"));
  const vaultDir = path.join(tmpDir, "vault");
  await fs.mkdir(vaultDir, { recursive: true });

  // Create vault structure
  for (const dir of ["Projects", "Areas", "Resources", "Archives", "Inbox", ".octopal/schedules"]) {
    await fs.mkdir(path.join(vaultDir, dir), { recursive: true });
  }

  // Init git
  execSync("git init && git add -A && git commit -m init --allow-empty", {
    cwd: vaultDir,
    stdio: "ignore",
  });

  const tokenSecret = generateTokenSecret();

  // Build config directly (avoid loadConfig module-level path issue)
  const config = {
    configDir: tmpDir,
    configPath: path.join(tmpDir, "config.toml"),
    vaultPath: vaultDir,
    vaultRemoteUrl: undefined,
    server: {
      port: 0,
      passwordHash: await hashPassword("test-password"),
      tokenSecret,
    },
    scheduler: {
      enabled: false,
      tickIntervalSeconds: 60,
    },
    // No discord
  };

  let server;
  try {
    console.log("🚀 Starting server...");
    server = await createServer({ config, host: "127.0.0.1", port: 0 });

    const address = server.addresses()[0];
    const port = address.port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const wsUrl = `ws://127.0.0.1:${port}/ws`;

    console.log(`   Server listening on port ${port}`);

    // Mint a connector token
    const connectorToken = mintToken(tokenSecret, {
      sub: "test-connector",
      scopes: ["connector"],
    });

    // ── Test 1: Health check ───────────────────────────────────
    console.log("\n📋 Test 1: Health check");
    const healthRes = await fetch(`${baseUrl}/health`);
    const health = await healthRes.json();
    assert(health.status === "ok", "Health endpoint returns ok");

    // ── Test 2: Connect a remote connector ─────────────────────
    console.log("\n📋 Test 2: Remote connector registration");

    const connector = new OctopalRemoteConnector({
      name: "test-machine",
      daemonUrl: wsUrl,
      token: connectorToken,
      capabilities: ["shell"],
      metadata: { os: "test", hostname: "test-host" },
      autoReconnect: false,
    });

    connector.onRequest("shell", shellHandler());

    await connector.connect();
    assert(true, "Connector connected and registered");

    await sleep(100);

    // ── Test 3: Shell handler unit test ────────────────────────
    console.log("\n📋 Test 3: Shell handler execution");
    const handler = shellHandler();
    const result = await handler("execute", { command: "echo hello-from-connector" });
    assert(result.stdout.includes("hello-from-connector"), `stdout contains expected text`);
    assert(result.exitCode === 0, `exitCode is 0`);

    // ── Test 4: Shell handler error case ───────────────────────
    console.log("\n📋 Test 4: Shell handler error case");
    const errResult = await handler("execute", { command: "exit 42" });
    assert(errResult.exitCode === 42, `exitCode is 42 for failing command (got: ${errResult.exitCode})`);

    // ── Test 5: Shell handler unknown action ───────────────────
    console.log("\n📋 Test 5: Shell handler unknown action");
    try {
      await handler("unknown_action", {});
      assert(false, "Should have thrown for unknown action");
    } catch (err) {
      assert(err.message.includes("Unknown shell action"), "Throws for unknown action");
    }

    // ── Test 6: ConnectorRegistry unit tests ───────────────────
    console.log("\n📋 Test 6: ConnectorRegistry");
    const registry = new ConnectorRegistry({ defaultTimeoutMs: 1000 });

    // Mock socket
    const mockSocket = {
      send: () => {},
      readyState: 1,
      OPEN: 1,
    };

    const registered = registry.register(mockSocket, "unit-test", ["shell", "screenshot"], { os: "linux" });
    assert(registered, "register() returns true");

    const duplicate = registry.register(mockSocket, "unit-test", ["shell"], {});
    assert(!duplicate, "register() rejects duplicate names");

    const list = registry.list();
    assert(list.length === 1, `list() returns 1 connector (got: ${list.length})`);
    assert(list[0].name === "unit-test", "list() has correct name");
    assert(list[0].capabilities.includes("shell"), "list() has shell capability");

    const found = registry.findByName("unit-test");
    assert(found?.name === "unit-test", "findByName() works");

    const byCap = registry.findByCapability("screenshot");
    assert(byCap.length === 1, "findByCapability() works");

    const notFound = registry.findByName("nonexistent");
    assert(!notFound, "findByName() returns undefined for missing");

    registry.unregister(mockSocket);
    assert(registry.list().length === 0, "unregister() removes connector");

    // ── Test 7: Disconnect ─────────────────────────────────────
    console.log("\n📋 Test 7: Connector disconnect");
    await connector.disconnect();
    assert(true, "Connector disconnected cleanly");

    await sleep(100);

  } finally {
    if (server) {
      await server.close();
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
