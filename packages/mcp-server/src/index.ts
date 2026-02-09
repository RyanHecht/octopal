#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  loadConfig,
  isConfigured,
  VaultManager,
  ParaManager,
  TaskManager,
  buildVaultTools,
  SYSTEM_PROMPT,
} from "@octopal/core";
import type { OctopalToolDef } from "@octopal/core";

// Lazy-initialized vault dependencies
let deps: { vault: VaultManager; para: ParaManager; tasks: TaskManager } | null = null;

async function ensureInitialized() {
  if (deps) return deps;

  const config = await loadConfig();
  if (!isConfigured(config)) {
    throw new Error(
      "Octopal is not configured. Run 'octopal setup' first to create a vault.",
    );
  }

  const vault = new VaultManager({
    localPath: config.vaultPath,
    remoteUrl: config.vaultRemoteUrl,
  });
  await vault.init();

  const para = new ParaManager(vault);
  await para.ensureStructure();

  const tasks = new TaskManager();
  deps = { vault, para, tasks };
  return deps;
}

const server = new McpServer(
  { name: "octopal", version: "0.1.0" },
  { capabilities: { tools: {}, prompts: {} } },
);

// Register the system prompt so clients can request it as context
server.prompt("octopal-system", "Octopal PARA knowledge management system prompt", async () => ({
  messages: [
    {
      role: "user" as const,
      content: { type: "text" as const, text: SYSTEM_PROMPT },
    },
  ],
}));

// Register all vault tools — lazy-init on first call
// We need to register them eagerly (so they appear in tool listings)
// but defer vault initialization to the first actual call.
function registerTools() {
  // Build tools with a placeholder deps to get the metadata.
  // The actual handler will initialize deps lazily.
  const placeholderVault = {} as VaultManager;
  const placeholderPara = {} as ParaManager;
  const placeholderTasks = {} as TaskManager;
  const toolDefs = buildVaultTools({
    vault: placeholderVault,
    para: placeholderPara,
    tasks: placeholderTasks,
  });

  for (const def of Object.values(toolDefs) as OctopalToolDef[]) {
    const shape = def.parameters.shape;

    // Wrap the handler to lazy-init the vault and rebuild the real handler
    const wrappedHandler = async (args: Record<string, unknown>) => {
      const realDeps = await ensureInitialized();
      const realTools = buildVaultTools(realDeps);
      const realDef = Object.values(realTools).find(
        (t) => t.name === def.name,
      );
      if (!realDef) {
        return { content: [{ type: "text" as const, text: `Unknown tool: ${def.name}` }] };
      }
      try {
        const result = await realDef.handler(args as any);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    };

    if (Object.keys(shape).length > 0) {
      server.tool(def.name, def.description, shape, wrappedHandler);
    } else {
      // No parameters — use the simpler overload
      server.tool(def.name, def.description, async () => {
        const realDeps = await ensureInitialized();
        const realTools = buildVaultTools(realDeps);
        const realDef = Object.values(realTools).find(
          (t) => t.name === def.name,
        );
        if (!realDef) {
          return { content: [{ type: "text" as const, text: `Unknown tool: ${def.name}` }] };
        }
        try {
          const result = await realDef.handler({} as any);
          return { content: [{ type: "text" as const, text: result }] };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      });
    }
  }
}

registerTools();

const transport = new StdioServerTransport();
await server.connect(transport);
