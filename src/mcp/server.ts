import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { queryEvents, findEvent, ackEvent, deleteProcessed, listSources } from "../db";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "hooksmith",
    version: "1.0.0",
  });

  // get_events — list recent webhook events from the inbox
  server.tool(
    "get_events",
    "List recent webhook events, optionally filtered by source and type",
    {
      source: z.string().optional(),
      type: z.string().optional(),
      limit: z.number().default(20),
    },
    async ({ source, type, limit }) => {
      const events = queryEvents({ source, type, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(events, null, 2) }],
      };
    },
  );

  // get_event — fetch a single event by ID
  server.tool(
    "get_event",
    "Get a single webhook event by its ID",
    { id: z.string() },
    async ({ id }) => {
      const event = findEvent(id);
      if (!event) {
        return {
          content: [{ type: "text", text: `Event not found: ${id}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(event, null, 2) }],
      };
    },
  );

  // ack_event — mark an event as processed
  server.tool(
    "ack_event",
    "Acknowledge an event (marks it as processed so it no longer appears in get_events)",
    { id: z.string() },
    async ({ id }) => {
      const ok = ackEvent(id);
      if (!ok) {
        return {
          content: [{ type: "text", text: `Event not found or already processed: ${id}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      };
    },
  );

  // list_sources — distinct sources that have sent events
  server.tool(
    "list_sources",
    "List all webhook sources that have sent at least one event",
    async () => {
      const sources = listSources();
      return {
        content: [{ type: "text", text: JSON.stringify(sources, null, 2) }],
      };
    },
  );

  // clear_events — permanently delete processed events
  server.tool(
    "clear_events",
    "Permanently delete processed events, optionally filtered by source",
    { source: z.string().optional() },
    async ({ source }) => {
      const deleted = deleteProcessed(source);
      return {
        content: [{ type: "text", text: JSON.stringify({ deleted }) }],
      };
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
