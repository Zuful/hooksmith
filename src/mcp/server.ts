import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { queryEvents, findEvent, ackEvent, deleteProcessed, listSources, insertEvent } from "../db";

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

  // replay_event — re-queue any event as a new pending event
  server.tool(
    "replay_event",
    "Re-queue any event (pending or processed) as a brand-new pending event with a fresh ID",
    { id: z.string() },
    async ({ id }) => {
      const event = findEvent(id);
      if (!event) {
        return {
          content: [{ type: "text", text: `Event not found: ${id}` }],
          isError: true,
        };
      }
      const newEvent = {
        id: crypto.randomUUID(),
        source: event.source,
        type: event.type,
        timestamp: new Date().toISOString(),
        payload: event.payload,
        raw: event.raw,
      };
      insertEvent(newEvent);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, original_id: id, new_id: newEvent.id }) }],
      };
    },
  );

  return server;
}

async function startHttpMcpServer(server: McpServer): Promise<void> {
  const port = parseInt(process.env.HOOKSMITH_MCP_PORT || "3421", 10);

  // Map of session ID -> transport for stateful sessions
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

  const httpServer = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname !== "/mcp") {
        return new Response("Not Found", { status: 404 });
      }

      // For initialization requests (no session ID), create a new transport
      const sessionId = req.headers.get("mcp-session-id");
      let transport: WebStandardStreamableHTTPServerTransport;

      if (sessionId && sessions.has(sessionId)) {
        transport = sessions.get(sessionId)!;
      } else if (!sessionId && req.method === "POST") {
        // New session — create transport
        transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, transport);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
          }
        };

        await server.connect(transport);
      } else if (req.method === "DELETE" && sessionId) {
        // Session not found for DELETE — already closed
        return new Response(null, { status: 204 });
      } else {
        return new Response("Bad Request: missing or invalid session", { status: 400 });
      }

      return transport.handleRequest(req);
    },
  });

  console.error(`Hooksmith MCP HTTP server listening on http://localhost:${httpServer.port}/mcp`);
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  if (process.env.HOOKSMITH_MCP_TRANSPORT === "http") {
    await startHttpMcpServer(server);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}
