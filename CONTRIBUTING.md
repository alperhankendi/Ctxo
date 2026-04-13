# Contributing to Ctxo

Ctxo is a pnpm monorepo with five published packages:

| Package | Role |
|---|---|
| `@ctxo/cli` | CLI + MCP server (primary) |
| `@ctxo/plugin-api` | Plugin protocol contracts (types) |
| `@ctxo/lang-typescript` | TypeScript/JavaScript plugin (ts-morph, full tier) |
| `@ctxo/lang-go` | Go plugin (tree-sitter, syntax tier) |
| `@ctxo/lang-csharp` | C# plugin (Roslyn + tree-sitter) |

## Local development

```bash
pnpm install
pnpm -r build            # build every package (required before tests)
pnpm -r typecheck
pnpm -r test
pnpm ctxo -- <args>      # run cli directly from source
```

Key conventions:

- Hexagonal boundaries inside `@ctxo/cli`: `core/` never imports from `adapters/` or `ports/`.
- Plugins import only from `@ctxo/plugin-api`, never from `@ctxo/cli`.
- Tests are co-located under `__tests__/` next to the source file they cover.

## Releasing — changeset workflow

Releases are driven by [changesets](https://github.com/changesets/changesets). No one bumps `package.json` versions by hand.

### When you open a PR

If your change affects a published package, add a changeset:

```bash
pnpm changeset
```

The prompt asks which packages changed and whether the bump is `patch`, `minor`, or `major`. It creates a file in `.changeset/` — commit it with your PR.

Not every PR needs a changeset. Pure internal refactors, doc tweaks, or CI-only changes can skip it.

### What the bot does

1. After your PR merges, the **Release** workflow runs on `master`.
2. If pending changesets exist, the workflow opens (or updates) a **"Version Packages"** PR that:
   - Bumps versions of every affected package
   - Updates each package's `CHANGELOG.md`
   - Deletes the consumed `.changeset/*.md` files
3. When a maintainer merges that PR, the workflow runs again, sees no pending changesets, and **publishes only the bumped packages** to npm with provenance attestation.
4. Each publish emits a `latest` dist-tag by default. To use `next` (alpha), enable pre-release mode first:
   ```bash
   pnpm changeset pre enter next
   # ...normal PR flow...
   pnpm changeset pre exit
   ```

### Repository secrets required

The Release workflow needs these GitHub repository secrets:

| Secret | How to get it |
|---|---|
| `NPM_TOKEN` | npmjs.com → Access Tokens → **Generate new automation token** (not classic). Scope: publish to `@ctxo/*`. |
| `GITHUB_TOKEN` | Provided by GitHub Actions automatically — no setup needed. |

Add `NPM_TOKEN` under **Settings → Secrets and variables → Actions → New repository secret**.

### Manual publish (fallback)

Only when the automation is broken:

```bash
pnpm -r build
pnpm --filter <package> publish --access public --tag next --no-git-checks
```

Publish order matters for fresh scope: `@ctxo/plugin-api` first, then `@ctxo/lang-*`, then `@ctxo/cli` last.

## Running the full CI locally

```bash
pnpm install --frozen-lockfile
pnpm -r build
pnpm -r lint
pnpm -r typecheck
pnpm -r test
pnpm --filter @ctxo/cli test:e2e
```

CI in GitHub Actions runs the same steps under Node 20 and Node 22. Both must stay green before a release PR merges.

## Adding a community language plugin

Plugins live outside this repo and declare `apiVersion: '1'` against `@ctxo/plugin-api`. A template repo is tracked in the Phase C roadmap — in the meantime, use one of the existing `packages/lang-*/` packages as reference:

- `src/index.ts` exports the `CtxoLanguagePlugin` default
- The adapter implements `ILanguageAdapter` from `@ctxo/plugin-api`
- Publish under `@<scope>/lang-<id>` (or unscoped `ctxo-lang-<id>` for community)
