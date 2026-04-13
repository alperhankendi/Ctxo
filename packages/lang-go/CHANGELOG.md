# @ctxo/lang-go

## 0.8.0

### Patch Changes

- 5b1ea92: Release pipeline hardening:

  - Release workflow now runs `pnpm -r typecheck` and `pnpm -r test` before publishing, so broken builds cannot ship to npm.
  - Verifies `NPM_TOKEN` secret is present before doing any work (fast fail with actionable message).
  - After publish, automatically fixes npm dist-tags so prerelease versions (`-alpha`, `-beta`, `-rc`, `-next`) move to the matching channel tag and `latest` stays pinned to the highest stable version.
  - All public packages now declare `publishConfig.access: public` and `publishConfig.provenance: true` so per-package npm publishes (manual or automated) keep provenance and visibility consistent.
  - New `dist-tag-repair` workflow available from the Actions tab to manually re-align dist-tags for any package, with a `dry_run` switch.

- Updated dependencies [5b1ea92]
  - @ctxo/plugin-api@0.7.1

## 0.8.0-alpha.0

### Minor Changes

- Full-tier Go semantic analysis via `ctxo-go-analyzer` binary bundled in
  `tools/ctxo-go-analyzer/`. Uses `go/packages` + `go/types` + `x/tools/go/ssa`
  - `callgraph/cha` to emit `calls` / `uses` / `implements` / `extends` edges
    with cross-package symbol resolution, plus a `dead` record listing
    unreachable function/method symbols.
- Reflect-safe dead-code heuristics for `reflect.TypeOf|ValueOf|New` and
  `json.Marshal|Unmarshal|NewDecoder|NewEncoder` arguments.
- Generic instantiation `typeArgs` preserved on edge metadata while keeping
  a single edge per generic type (ADR-013 §4 Q4).
- New `GoCompositeAdapter` picks full-tier when Go ≥ 1.22 + analyzer binary
  build succeeds; falls back to tree-sitter syntax tier otherwise.
- Lazy binary build into `~/.cache/ctxo/lang-go-analyzer/<sourceHash-goVersion>/`
  on first use; subsequent runs reuse the cached binary.
- Tree-sitter adapter no longer filters out unexported symbols; matches the
  new analyzer layer's coverage.

## 0.7.1

### Patch Changes

- 35c8b76: Bump tree-sitter and its grammars to 0.25 (tree-sitter, tree-sitter-go, tree-sitter-c-sharp). The shared TreeSitterAdapter Language type is widened so future grammar major bumps don't require a coordinated tsc fix.
