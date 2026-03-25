import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WebhookEvent } from "../types";

const inboxDir =
  process.env.HOOKSMITH_INBOX_DIR || join(homedir(), ".hooksmith", "inbox");
const processedDir = join(inboxDir, "processed");

async function readEvent(filePath: string): Promise<WebhookEvent | null> {
  try {
    const file = Bun.file(filePath);
    return (await file.json()) as WebhookEvent;
  } catch {
    return null;
  }
}

async function readAllEvents(dir: string): Promise<WebhookEvent[]> {
  const glob = new Bun.Glob("*.json");
  const events: WebhookEvent[] = [];
  for await (const path of glob.scan({ cwd: dir, absolute: false })) {
    const event = await readEvent(join(dir, path));
    if (event) events.push(event);
  }
  return events;
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "hooksmith",
    version: "1.0.0",
  });

  // get_events — list recent webhook events
  server.tool(
    "get_events",
    "List recent webhook events from the inbox, optionally filtered by source and type",
    {
      source: z.string().optional(),
      type: z.string().optional(),
      limit: z.number().default(20),
    },
    async ({ source, type, limit }) => {
      let events = await readAllEvents(inboxDir);

      if (source) events = events.filter((e) => e.source === source);
      if (type) events = events.filter((e) => e.type === type);

      events.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      events = events.slice(0, limit);

      return {
        content: [{ type: "text", text: JSON.stringify(events, null, 2) }],
      };
    }
  );

  // get_event — get a single event by ID
  server.tool(
    "get_event",
    "Get a single webhook event by its ID",
    { id: z.string() },
    async ({ id }) => {
      const event = await readEvent(join(inboxDir, `${id}.json`));
      if (!event) {
        return {
          content: [{ type: "text", text: `Event not found: ${id}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(event, null, 2) }],
      };
    }
  );

  // ack_event — acknowledge/process an event
  server.tool(
    "ack_event",
    "Acknowledge an event by moving it from inbox to processed",
    { id: z.string() },
    async ({ id }) => {
      const src = join(inboxDir, `${id}.json`);
      const dest = join(processedDir, `${id}.json`);

      try {
        await Bun.write(dest, Bun.file(src));
        const { unlink } = await import("node:fs/promises");
        await unlink(src);
      } catch {
        return {
          content: [
            { type: "text", text: `Failed to acknowledge event: ${id}` },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      };
    }
  );

  // list_sources — list unique sources
  server.tool(
    "list_sources",
    "List all webhook sources that have sent events",
    async () => {
      const events = await readAllEvents(inboxDir);
      const sources = [...new Set(events.map((e) => e.source))].sort();
      return {
        content: [{ type: "text", text: JSON.stringify(sources, null, 2) }],
      };
    }
  );

  // clear_events — remove acknowledged events
  server.tool(
    "clear_events",
    "Remove acknowledged (processed) events, optionally filtered by source",
    { source: z.string().optional() },
    async ({ source }) => {
      const { unlink } = await import("node:fs/promises");
      let events = await readAllEvents(processedDir);

      if (source) events = events.filter((e) => e.source === source);

      let deleted = 0;
      for (const event of events) {
        try {
          await unlink(join(processedDir, `${event.id}.json`));
          deleted++;
        } catch {
          // skip files that can't be deleted
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ deleted }) }],
      };
    }
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
