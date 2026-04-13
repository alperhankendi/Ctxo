# @ctxo/cli

## 0.7.1

### Patch Changes

- 35659c8: Improve GitHub Releases format. Per-package releases are replaced with a single umbrella release per published run, listing every package version published, the full compatible-set matrix across all `@ctxo/*` packages, and per-package CHANGELOG excerpts. Plugin-only releases also produce an umbrella entry. Alpha/beta/rc/next versions are auto-marked as pre-release.
