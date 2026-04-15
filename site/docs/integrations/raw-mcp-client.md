---
title: "Raw MCP Client"
description: "Talk to Ctxo via the Model Context Protocol SDK."
---

# Raw MCP Client

You don't need an editor to use Ctxo. The
[`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
gives you a programmatic client you can drop into scripts, bots, CI jobs, or
custom agents.

This page shows the minimal stdio and HTTP client against Ctxo. For
agent-framework integrations, see
the [Agentic AI Integration guide](https://github.com/alperhankendi/Ctxo/blob/master/docs/agentic-ai-integration.md).

## Install

::: code-group

```bash [pnpm]
pnpm add @modelcontextprotocol/sdk @ctxo/cli
```

```bash [npm]
npm install @modelcontextprotocol/sdk @ctxo/cli
```

```bash [yarn]
yarn add @modelcontextprotocol/sdk @ctxo/cli
```

:::

## Stdio client

Spawn Ctxo as a subprocess and talk to it over stdin/stdout:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['@ctxo/cli', 'mcp'],
  env: { ...process.env, DEBUG: 'ctxo:*' }, // optional
});

const client = new Client(
  { name: 'my-ctxo-script', version: '0.1.0' },
  { capabilities: {} },
);

await client.connect(transport);

// Enumerate tools
const { tools } = await client.listTools();
console.log(tools.map((t) => t.name));
// => ['get_logic_slice', 'get_blast_radius', ... 14 total]

// Call get_logic_slice
const result = await client.callTool({
  name: 'get_logic_slice',
  arguments: {
    symbolId:
      'packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class',
    detail: 'L2',
  },
});

const payload = JSON.parse(result.content[0].text);
console.log(payload.symbol.name, payload._meta);

await client.close();
```

Every tool response follows the
[standard envelope](/mcp-tools/response-format) - a single `text` content
block containing JSON with a `_meta` object for pagination and truncation
signals.

## HTTP transport

Ctxo also speaks MCP over HTTP. Set `CTXO_HTTP_PORT` and the server binds
there instead of stdio:

```bash
CTXO_HTTP_PORT=7337 npx @ctxo/cli mcp
```

Then connect with the streamable HTTP transport:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:7337/mcp'),
);

const client = new Client({ name: 'my-script', version: '0.1.0' }, { capabilities: {} });
await client.connect(transport);

const tools = await client.listTools();
console.log(tools.tools.length); // 14
```

::: tip Why HTTP?
One Ctxo process, many clients. Useful for sharing the index between several
agents on the same box, exposing Ctxo to a sandboxed runtime, or wiring it
into a long-lived service that cannot spawn subprocesses.
:::

::: warning HTTP is localhost-only by default
Do not expose `CTXO_HTTP_PORT` to the public internet without putting an
auth proxy in front. Ctxo has no built-in authentication.
:::

## Verify

Run the stdio example above with:

```bash
npx tsx ./my-ctxo-script.ts
```

You should see 14 tool names and a JSON payload for the `SqliteStorageAdapter`
symbol. If `listTools` returns empty, the index has not been built - run
`npx ctxo index` in the target repo first.

## Tips

- **Run inside the target repo.** Ctxo resolves `.ctxo/` relative to its cwd.
  If your script lives elsewhere, set `cwd` on the transport:
  `new StdioClientTransport({ command, args, cwd: '/path/to/repo' })`.
- **Handle graceful misses.** A valid response may be
  `{ found: false, hint: '...' }`. Check that before indexing into fields.
- **Never throw from handlers.** Ctxo returns `{ error: true, message }` in
  the text content for any failure; treat the shape as always-valid JSON.
- **Read the envelope.** `_meta.truncated` tells you the response was clipped
  at `CTXO_RESPONSE_LIMIT` (default 8192 bytes). Bump it with the env var or
  page via `intent` filters.

## Next steps

- [MCP SDK docs](https://github.com/modelcontextprotocol/typescript-sdk) - full
  client API
- [MCP Tools Overview](/mcp-tools/overview) - the 14 tools in detail
- [Claude Agent SDK](https://github.com/alperhankendi/Ctxo/blob/master/docs/agentic-ai-integration.md) - higher-level agent
  framework that wraps this client
- [MCP Client Setup](/introduction/mcp-client-setup) - editor-side configs
