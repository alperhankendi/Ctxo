---
title: "Release Process"
description: "Changesets workflow and npm publishing."
---

# Release Process

Ctxo ships via [changesets](https://github.com/changesets/changesets) driven by `.github/workflows/release.yml`. Every published version flows through the same gate: NPM token check, build, typecheck, test, publish, dist-tag repair, umbrella GitHub Release. There is no supported manual publish path.

## Flow

```
pnpm changeset            # 1. describe the change + pick bump type
  └─ commit .changeset/*.md, push to master
       └─ bot opens "chore(release): version packages" PR   # 2. versioning
            └─ merge the PR
                 └─ workflow runs: build → test → publish   # 3. release
                      └─ dist-tags repaired, umbrella GH Release created
```

| Step | Who | What |
| --- | --- | --- |
| 1. Author changeset | Developer | `pnpm changeset`, pick affected packages and semver bump, write the release note. |
| 2. Version PR | Bot | `changesets/action` opens or updates the Version Packages PR with CHANGELOG diffs. |
| 3. Publish | Workflow | On merge, `pnpm release` (= `pnpm -r build && changeset publish`) publishes to npm. |
| 4. Tag repair | Workflow | Prerelease versions moved off `latest` onto `alpha`/`beta`/`rc`/`next`; `latest` re-pinned to highest stable. |
| 5. GitHub Release | Workflow | One umbrella release per run with the Compatible Set matrix. |

Only packages listed in a changeset get bumped and published. Releasing a single package is as simple as creating a changeset that lists only that package.

## Gates

The workflow runs these in order and aborts on the first failure:

1. `NPM_TOKEN` secret check.
2. `pnpm install --frozen-lockfile`.
3. `pnpm -r build` (sibling `dist/` must exist for cross-package typecheck).
4. `pnpm -r typecheck`.
5. `pnpm -r test`.
6. `changeset publish` with `NPM_CONFIG_PROVENANCE=true`.
7. Dist-tag repair.
8. Umbrella GitHub Release.

No manual `npm publish` invocation skips these gates.

## Prerelease channels

Versions whose semver tail matches one of these identifiers are treated as prereleases:

| Identifier | npm dist-tag | GitHub Release flag |
| --- | --- | --- |
| `-alpha.N` | `alpha` | `--prerelease` |
| `-beta.N` | `beta` | `--prerelease` |
| `-rc.N` | `rc` | `--prerelease` |
| `-next.N` | `next` | `--prerelease` |

After publish, the workflow moves the prerelease version off the default `latest` tag and onto the matching channel tag, then re-points `latest` at the highest still-published stable version of that package. This keeps `npm install @ctxo/cli` safe even during an alpha cycle.

## Umbrella GitHub Releases

Per-package GitHub Releases are disabled (`createGithubReleases: false`). Instead, one umbrella release is created per publish run:

- **Tag:** `v<cli-version>` when `@ctxo/cli` was bumped; otherwise the highest plugin version with a ` - Plugin Release` title suffix.
- **Body:** a "Packages published" list, a Compatible Set matrix of every public workspace package, and CLI or plugin changelog extracts.
- **Tag collisions:** when the chosen tag already exists (e.g. plugins catch up to a past CLI version), the workflow appends `-plugins.<run-id>` and the maintainer can rename if desired.

## Manual repair

If `latest` gets clobbered outside a normal run, use the `dist-tag-repair.yml` `workflow_dispatch`. It accepts a `dry_run` input so you can preview the tag moves before applying them.

::: warning
Do not bypass changesets with a manual `npm publish`. Manual publishes skip the test gate, skip provenance attestation, skip CHANGELOG generation, and do not create a GitHub Release.
:::

::: tip
Always push as `alperhankendi` when authoring changesets that will be released to npm - the release trail and the git author should match.
:::

## See also

- [`@ctxo/cli` on npm](https://www.npmjs.com/package/@ctxo/cli)
- [`@ctxo/plugin-api`](https://www.npmjs.com/package/@ctxo/plugin-api)
- [`@ctxo/lang-typescript`](https://www.npmjs.com/package/@ctxo/lang-typescript)
- [`@ctxo/lang-go`](https://www.npmjs.com/package/@ctxo/lang-go)
- [`@ctxo/lang-csharp`](https://www.npmjs.com/package/@ctxo/lang-csharp)
