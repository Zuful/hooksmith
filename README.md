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

## Development

```bash
bun install
bun run index.ts
bun test
```
