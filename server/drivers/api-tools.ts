import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { SendTurnInput } from "../contracts.ts";
import { stripWorkspaceCredentialEnv } from "../config.ts";

export type ApiTool = NonNullable<SendTurnInput["tools"]>[number];

/** Only harness-supplied transports are spawned; models cannot choose commands. */
export async function connectApiTools(turn: SendTurnInput, signal: AbortSignal) {
  const clients: Client[] = [];
  const tools: ApiTool[] = [...(turn.tools ?? [])];
  const close = async () => { await Promise.allSettled(clients.map((client) => client.close())); };
  const abort = () => { void close(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (const [namespace, config] of Object.entries({ composio: turn.integrations?.composio, agents: turn.integrations?.agents })) {
      if (!config) continue;
      signal.throwIfAborted();
      const env = { ...process.env };
      stripWorkspaceCredentialEnv(env);
      const client = new Client({ name: "magicteams-connected-api", version: "1.0.0" });
      clients.push(client);
      const transport = new StdioClientTransport({
        command: config.command, args: config.args,
        env: Object.fromEntries(Object.entries({ ...env, ...config.env }).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
        stderr: "ignore",
      });
      await client.connect(transport, { signal, timeout: 30_000 });
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const result = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 30_000 });
        for (const tool of result.tools) {
          if (tools.length >= 128) throw new Error("Too many tools for Connected API (maximum 128). Reduce connected toolsets.");
          const name = `${namespace}_${tools.length}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
          tools.push({ name, description: tool.description ?? tool.name, parameters: tool.inputSchema,
            execute: async (args, callSignal) => JSON.stringify(await client.callTool({ name: tool.name, arguments: args }, undefined, { signal: callSignal, timeout: 60_000 })).slice(0, 100_000),
          });
        }
        cursor = result.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error("Connected tool catalog repeated its pagination cursor");
        if (cursor) cursors.add(cursor);
      } while (cursor);
    }
    return { tools, close: async () => { signal.removeEventListener("abort", abort); await close(); } };
  } catch (error) {
    signal.removeEventListener("abort", abort);
    await close();
    throw error;
  }
}
