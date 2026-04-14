---
title: "Masking Pipeline"
description: "How responses are sanitized before delivery to the client."
---

# Masking Pipeline

Every MCP tool response passes through a masking pipeline before it leaves
the server. The goal is simple: **no secret embedded in source code ever
reaches the agent verbatim.**

This is not a feature the user opts into. It is a mandatory final step in
the response path, enforced at the adapter boundary so no tool handler can
skip it.

## Why it exists

Agents connected to Ctxo are, by definition, looking at your source. Source
is the place API keys and connection strings accidentally end up. Sending
those back to a remote LLM would be a data-exfiltration incident. The
masking pipeline is the last line of defence.

Secondary benefit: **predictable size**. Masked placeholders are short and
bounded, so a pre-masking token estimate remains accurate after masking.

## Where it lives

[`packages/cli/src/core/masking/masking-pipeline.ts`](https://github.com/alperhankendi/ctxo/blob/master/packages/cli/src/core/masking/masking-pipeline.ts).
One class, `MaskingPipeline`, with one method that matters: `mask(text)`.
Every MCP handler calls it on the serialized JSON payload, for example in
`adapters/mcp/get-ranked-context.ts`:

```ts
const payload = masking.mask(JSON.stringify(wrapResponse(result)));
```

## Default patterns

The default set targets the secrets that most often leak into source:

| Label          | Catches                                                        |
| -------------- | -------------------------------------------------------------- |
| `AWS_KEY`      | AWS access key IDs (`AKIA` + 16 alphanumerics)                 |
| `AWS_SECRET`   | 40-char base64 with at least one `/` or `+` (excludes git hashes) |
| `JWT`          | `eyJ...` three-segment JWT tokens                              |
| `PRIVATE_IP`   | RFC1918 IPv4 (10/8, 172.16-31/12, 192.168/16)                  |
| `PRIVATE_IPV6` | `fc00::/7` unique-local IPv6                                   |
| `ENV_SECRET`   | `FOO_SECRET=...`, `FOO_KEY=...`, `FOO_TOKEN=...`, `FOO_PASSWORD=...` |
| `GCP_KEY`      | `"private_key": "-----BEGIN ..."` blocks                       |
| `AZURE_KEY`    | `AccountKey=...` connection-string fragments                   |

Matches are replaced with `[REDACTED:<label>]` so the agent can still see
*that* a secret was present (useful context) without seeing the value.

::: warning What masking does not do
- It does **not** mask PII (names, emails). Source rarely contains those
  and false positives would be high.
- It does **not** mask environment variables referenced symbolically (e.g.
  `process.env.DB_PASSWORD`). Those are names, not values.
- It is a **string-replace pass**, not a semantic scanner. Novel secret
  formats need a custom pattern.
:::

## Configuration

Additional patterns can be supplied via config. The loader
`MaskingPipeline.fromConfig` accepts a list of `{ pattern, flags?, label }`
entries:

```yaml
# .ctxo/config.yaml (illustrative)
masking:
  patterns:
    - pattern: "sk_live_[A-Za-z0-9]{24,}"
      label: "STRIPE_KEY"
    - pattern: "xoxb-[0-9-]+"
      label: "SLACK_BOT_TOKEN"
```

Invalid regex sources are logged and skipped so a bad config does not crash
the server.

::: info Config surface
The exact config key is an implementation detail. Refer to the source of
`MaskingPipeline.fromConfig` and the config loader for the current shape.
:::

## Performance

The pipeline clones each regex at construction time so concurrent requests
never share `lastIndex` state. Masking is a linear sweep of the payload
string, dominated by the number of patterns, not the payload size. For
typical MCP responses (under 16 KB) it is microseconds.

## Predictable size for token budgets

Because `[REDACTED:<label>]` is short and deterministic, the post-masking
payload is always *at most* the size of the pre-masking payload. This lets
the [response envelope](/reference/response-envelope) report an accurate
`totalBytes` without a second pass and keeps the 8 KB default truncation
threshold safe.

## Related

- **[Response format](/mcp-tools/response-format)** how `_meta` reports
  truncation and size.
- **[Response envelope reference](/reference/response-envelope)** exact
  field semantics.
- **[Error handling](/architecture/error-handling)** masking sits at the
  adapter boundary and all MCP responses pass through it before delivery.
