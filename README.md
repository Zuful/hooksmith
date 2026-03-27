# Hooksmith

Universal webhook receiver MCP plugin for Claude Code.

## Overview

Hooksmith receives webhooks from any source (GitHub, GitLab, Stripe, etc.), normalizes them into a common event format, and exposes them to Claude Code via the Model Context Protocol (MCP).

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────┐
│  HTTP Server │────▶│   Adapters   │────▶│ MCP Layer │
│  (Bun.serve) │     │ (normalizers)│     │  (tools/  │
│              │     │              │     │ resources) │
└─────────────┘     └──────────────┘     └───────────┘
```

- **HTTP Server** (`src/core/`): Receives incoming webhook HTTP requests via `Bun.serve()`.
- **Adapters** (`src/adapters/`): Source-specific modules that validate and normalize raw webhook payloads into a common `WebhookEvent` format.
- **MCP Layer** (`src/mcp/`): Exposes normalized events to Claude Code as MCP tools and resources.

## Project Structure

```
src/
  types.ts        — Shared WebhookEvent interface
  core/           — HTTP server and request routing
  adapters/       — Webhook source adapters (GitHub, Stripe, etc.)
  mcp/            — MCP server, tools, and resources
tests/
  fixtures/       — Test fixture data
```

## MCP Transport Modes

Hooksmith supports two MCP transport modes:

### stdio (default)

The default mode uses stdio, suitable for Claude Code plugin config where Claude spawns Hooksmith as a subprocess.

```json
{
  "mcpServers": {
    "hooksmith": {
      "command": "bun",
      "args": ["run", "/path/to/hooksmith/src/index.ts"]
    }
  }
}
```

### HTTP (Streamable HTTP)

Set `HOOKSMITH_MCP_TRANSPORT=http` to start an HTTP-based MCP server using the Streamable HTTP transport. This allows Claude to connect over HTTP instead of spawning a subprocess.

| Environment Variable | Default | Description |
|---|---|---|
| `HOOKSMITH_MCP_TRANSPORT` | `stdio` | Set to `http` to enable HTTP mode |
| `HOOKSMITH_MCP_PORT` | `3421` | Port for the MCP HTTP server |

Start in HTTP mode:

```bash
HOOKSMITH_MCP_TRANSPORT=http bun run src/index.ts
```

Claude Code config for HTTP mode:

```json
{
  "mcpServers": {
    "hooksmith": {
      "type": "streamableHttp",
      "url": "http://localhost:3421/mcp"
    }
  }
}
```

## Development

```bash
bun install
bun run index.ts
bun test
```
