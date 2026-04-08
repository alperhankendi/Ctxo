# Ctxo — Agentic AI Integration Guide

> How to use Ctxo as a code intelligence layer inside autonomous AI agents and agentic development platforms.

## Overview

Ctxo is an MCP (Model Context Protocol) server that provides 14 code intelligence tools — symbol graphs, blast radius, architectural overlays, change intelligence, dead code detection, and more. This guide covers how to integrate Ctxo into agentic AI applications that autonomously develop, review, or analyze code.

## Two Integration Paths

| Path | When to Use | Transport |
|---|---|---|
| **Agent SDK** (recommended) | Building with Claude Agent SDK or OpenAI Agents SDK | stdio or HTTP |
| **Raw MCP Client** | Custom agent framework, CI/CD pipeline, or any LLM API | stdio or HTTP |

---

## 1. Claude Agent SDK (TypeScript)

The Claude Agent SDK has first-class MCP support. Pass Ctxo as an `mcpServers` entry and the SDK handles tool discovery, schema injection, and call routing automatically.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Analyze the blast radius of the AuthService class and suggest safe refactoring steps",
  options: {
    mcpServers: {
      ctxo: {
        command: "npx",
        args: ["-y", "ctxo-mcp"]
      }
    },
    allowedTools: ["mcp__ctxo__*"]
  }
})) {
  if (message.type === "result" && message.subtype === "success") {
    console.log(message.result);
  }
}
```

### With Multiple MCP Servers

```typescript
for await (const message of query({
  prompt: "Review the PR changes, check blast radius, and post a summary comment",
  options: {
    mcpServers: {
      ctxo: {
        command: "npx",
        args: ["-y", "ctxo-mcp"]
      },
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
      }
    },
    allowedTools: ["mcp__ctxo__*", "mcp__github__*"]
  }
})) {
  // Agent uses ctxo for code analysis + github for PR interaction
}
```

### CI/CD Pipeline Example

```typescript
// ci-review.ts — runs on every PR
import { query } from "@anthropic-ai/claude-agent-sdk";

async function reviewPR() {
  for await (const message of query({
    prompt: `
      1. Use get_pr_impact to analyze recent changes
      2. For any high-risk symbols, use get_blast_radius  
      3. Check get_why_context for any anti-patterns in changed code
      4. Summarize findings as a PR review comment
    `,
    options: {
      mcpServers: {
        ctxo: { command: "npx", args: ["-y", "ctxo-mcp"] }
      },
      allowedTools: ["mcp__ctxo__*"],
      permissionMode: "bypassPermissions"
    }
  })) {
    if (message.type === "result" && message.subtype === "success") {
      return message.result;
    }
  }
}
```

---

## 2. OpenAI Agents SDK (Python)

```python
from agents import Agent, Runner
from agents.mcp import MCPServerStdio

async def analyze_codebase():
    ctxo = MCPServerStdio(
        name="Ctxo Code Intelligence",
        params={
            "command": "npx",
            "args": ["-y", "ctxo-mcp"]
        },
        cache_tools_list=True  # Cache tool schemas across runs
    )
    
    async with ctxo:
        agent = Agent(
            name="Code Reviewer",
            instructions="""You are a code review agent. Use Ctxo tools to:
            - get_pr_impact for PR-level risk assessment
            - get_blast_radius before suggesting any code changes
            - get_why_context to check for problematic history
            - get_context_for_task with taskType matching your goal""",
            mcp_servers=[ctxo]
        )
        
        result = await Runner.run(
            agent, 
            "Analyze the impact of recent changes and identify high-risk areas"
        )
        print(result.final_output)
```

### Remote HTTP Server (OpenAI HostedMCPTool)

If Ctxo is deployed as a remote HTTP server:

```python
from agents import Agent, HostedMCPTool

agent = Agent(
    name="Code Analyst",
    tools=[
        HostedMCPTool(tool_config={
            "type": "mcp",
            "server_label": "ctxo",
            "server_url": "https://your-ctxo-server.example.com/mcp",
            "require_approval": "never"
        })
    ]
)
```

---

## 3. LangChain / LangGraph (Python)

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

async def get_ctxo_tools():
    client = MultiServerMCPClient({
        "ctxo": {
            "command": "npx",
            "args": ["-y", "ctxo-mcp"],
            "transport": "stdio"
        }
    })
    
    tools = await client.get_tools()
    # Returns LangChain Tool objects — usable with any LangChain agent
    return tools
```

---

## 4. Raw MCP Client (TypeScript)

For custom agent frameworks or direct API integration:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Anthropic from "@anthropic-ai/sdk";

// Step 1: Connect to Ctxo
const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "ctxo-mcp"],
  cwd: "/path/to/target-repo"
});
const mcpClient = new Client({ name: "my-agent", version: "1.0.0" });
await mcpClient.connect(transport);

// Step 2: Discover tools
const { tools } = await mcpClient.listTools();

// Step 3: Convert to Claude API format
const claudeTools = tools.map(t => ({
  name: t.name,
  description: t.description || "",
  input_schema: t.inputSchema
}));

// Step 4: Use with Claude Messages API
const anthropic = new Anthropic();
const messages = [{ role: "user", content: "Analyze blast radius of UserService" }];

let response = await anthropic.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 4096,
  tools: claudeTools,
  messages
});

// Step 5: Handle tool calls in a loop
while (response.stop_reason === "tool_use") {
  const toolResults = [];
  
  for (const block of response.content) {
    if (block.type === "tool_use") {
      const result = await mcpClient.callTool({
        name: block.name,
        arguments: block.input
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content.map(c => 
          c.type === "text" ? { type: "text", text: c.text } : c
        )
      });
    }
  }
  
  messages.push({ role: "assistant", content: response.content });
  messages.push({ role: "user", content: toolResults });
  
  response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    tools: claudeTools,
    messages
  });
}

console.log(response.content);

// Step 6: Cleanup
await mcpClient.close();
```

### Converting to OpenAI Format

```typescript
// For OpenAI API instead of Claude:
const openaiTools = tools.map(t => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description || "",
    parameters: t.inputSchema
  }
}));
```

---

## 5. Claude Messages API — MCP Connector (Beta)

For remote Ctxo servers, Anthropic's API can connect directly — no client-side MCP code needed:

```typescript
const response = await anthropic.beta.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 4096,
  messages: [{ role: "user", content: "Analyze the codebase architecture" }],
  mcp_servers: [{
    type: "url",
    url: "https://your-ctxo-server.example.com/mcp",
    name: "ctxo",
    authorization_token: "Bearer YOUR_TOKEN"
  }],
  betas: ["mcp-client-2025-11-20"]
});
```

> **Note:** Requires Ctxo to be deployed with Streamable HTTP transport. Only supports remote servers (no stdio).

---

## Tool Selection Guide for Agents

Include this in your agent's system prompt for optimal tool selection:

```
## Ctxo Tool Usage Guide

Reviewing a PR or recent changes?
  → get_pr_impact (single call, full risk assessment)

About to modify a function or class?
  → get_blast_radius (what breaks if I change this?)
  → then get_why_context (any history of problems?)

Need to understand what a symbol does?
  → get_context_for_task(taskType: "understand")

Fixing a bug?
  → get_context_for_task(taskType: "fix")

Adding a feature?
  → get_context_for_task(taskType: "extend")

Refactoring?
  → get_context_for_task(taskType: "refactor")

Don't know the symbol name?
  → search_symbols (by name/regex)
  → get_ranked_context (by natural language query)

Finding unused code?
  → find_dead_code

Checking if safe to delete?
  → find_importers (who depends on this?)
```

---

## Best Practices

### 1. Always Index First
Ctxo requires a pre-built index. In CI/CD, add an indexing step:
```bash
npx ctxo-mcp index          # Build index
npx ctxo-mcp index --check  # CI gate: fail if stale
```

### 2. Use `get_pr_impact` as Entry Point
For PR review agents, start with `get_pr_impact` — it combines changed symbols + blast radius + co-change analysis in a single call, saving multiple round trips.

### 3. Use `get_context_for_task` for Intent-Aware Context
Instead of calling multiple tools manually, use `get_context_for_task` with the appropriate `taskType`. It assembles the right context mix automatically.

### 4. Cache Tool Lists
When creating MCP clients programmatically, enable tool list caching to avoid re-fetching schemas on every agent run:
```python
MCPServerStdio(..., cache_tools_list=True)
```

### 5. Set Working Directory
Ctxo operates on the codebase in its working directory. Always set `cwd` when spawning:
```typescript
{ command: "npx", args: ["-y", "ctxo-mcp"], cwd: "/path/to/repo" }
```

### 6. All Tools Are Read-Only
Ctxo tools only read from the index — they never modify files. This makes them safe for auto-approval in agent frameworks.
