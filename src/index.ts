import { startMcpServer } from "./mcp/server";

// Start the HTTP webhook receiver
// The core server module is imported dynamically so it self-starts via Bun.serve()
await import("./core/server");

// Start the MCP server on stdio
await startMcpServer();
