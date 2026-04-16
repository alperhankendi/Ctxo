<div align="center">

[![npm version](https://img.shields.io/npm/v/@ctxo/cli.svg)](https://www.npmjs.com/package/@ctxo/cli)
[![CI](https://github.com/alperhankendi/Ctxo/actions/workflows/ci.yml/badge.svg)](https://github.com/alperhankendi/Ctxo/actions/workflows/ci.yml)
[![Release](https://github.com/alperhankendi/Ctxo/actions/workflows/release.yml/badge.svg)](https://github.com/alperhankendi/Ctxo/actions/workflows/release.yml)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/hero-svg.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/img/hero-svg.svg">
  <img alt="Ctxo — Code intelligence for AI agents" src="docs/img/hero-svg.svg" width="100%">
</picture>

### AI agents don't fail because they can't code.<br>They fail because they **code blind**.<br>Ctxo gives them the full picture **before they write a single line**.

```Shell
npx @ctxo/init
```

**[Get Started →](https://alperhankendi.github.io/Ctxo/docs/)**

</div>

***

<table>
<tr>
<td width="50%" valign="top">

### Without Ctxo

- ✕ Context window saturated
- ✕ Partial context hallucination
- ✕ Lost-in-the-middle
- ✕ Context poisoning
- ✕ 10-20 calls per symbol
- ✕ Stale reasoning after iterations

</td>
<td width="50%" valign="top">

### With Ctxo

- ✓ Clean, relevant context only
- ✓ One call replaces full exploration
- ✓ Structured symbol graphs + deps
- ✓ Built-in usage stats & insights
- ✓ Detects architectural drift + boundary violations

</td>
</tr>
</table>

## Index Visualizer

Ctxo ships with an interactive visualizer that renders your codebase index as a dependency graph. Explore symbols, edges, layers, and PageRank scores visually deployed automatically to GitHub Pages on every push.

![1.00](docs/img/ui.png)

[Open Live Visualizer](https://alperhankendi.github.io/Ctxo/ctxo-visualizer.html)

## Links

* [Docs](https://alperhankendi.github.io/Ctxo/docs/) — quick start, MCP tools, CLI reference, integrations
* [npm](https://www.npmjs.com/package/@ctxo/cli)
* [Changelog](CHANGELOG.md)
* [LLM Reference](llms-full.txt)

## License

MIT
