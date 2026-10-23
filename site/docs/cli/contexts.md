---
title: "ctxo contexts"
description: "Show the candidate bounded contexts computed by ctxo index."
---

# ctxo contexts

Prints the **contexts view**: candidate bounded contexts that `ctxo index`
computed from file-level clusters of dependencies and co-change, with hub files
damped. It reads `.ctxo/index/contexts-view.json` and computes nothing itself,
so it is instant and read-only.

Candidates are a starting point for a context map, not a verdict. The label is a
suggestion (the common directory of the members), and the terms and collisions
are input for a glossary session. See
[`get_architectural_overlay`](/mcp-tools/get-architectural-overlay) for the same
data over MCP.

## Synopsis

```shell
ctxo contexts [--json]
```

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--json` | `false` | Print the full `contexts-view.json` to stdout instead of a table to stderr |

## Table output

The table goes to stderr, like the other human-readable commands, so stdout
stays clean for `--json`. Paths below are synthetic.

```
[ctxo] Contexts view at 857052d: 3 candidates cover 118/124 files (95%), 2 hubs, 6 unclustered, 1 collisions, 0 shared tables
#1  52 files  cohesion 0.81  src/billing  terms: invoice, payment, ledger
#2  41 files  cohesion 0.74  src/accounts  terms: customer, account, address
#3  25 files  cohesion 0.69  src/shared  terms: config, retry, clock
hub src/shared/db-factory.ts (fan-in, god-node, 48 dependents) -> #3
hub src/shared/logger.ts (fan-in, 31 dependents) -> #3
```

### Shared tables

With [`@ctxo/lang-sql`](/languages/sql) installed, the view also reports data
coupling: tables and views that files of two or more candidates read or write,
directly or through a stored procedure they execute. A candidate line with
shared tables ends with their count, and each shared resource gets a `shared`
line with its kind (`table`, `view` or `external` when no indexed `.sql` file
defines it), the access modes per candidate and its writers: `owner #<id>` when
one candidate writes it, `several writers`, or `read only`.

```
[ctxo] Contexts view at 4be19c2: 2 candidates cover 64/66 files (97%), 1 hubs, 2 unclustered, 0 collisions, 2 shared tables
#1  38 files  cohesion 0.78  src/Lending  terms: loan, renewal, due shared tables: 2
#2  26 files  cohesion 0.72  src/Members  terms: member, card, fine shared tables: 2
hub src/Shared/Db.cs (fan-in, 22 dependents) -> #1
shared table dbo.loans  #1 reads+writes, #2 reads  owner #1
shared table dbo.members  #1 reads, #2 reads+writes  owner #2
```

`ctxo index` reports the same count at the end of its contexts line
(`, 2 shared tables`) when there is any.

How stored procedures count:

- A procedure's reads and writes count for the candidates that execute it,
  directly or through other procedures, not for the candidate whose files hold
  the script. Whether a procedure is executed is decided by its canonical name,
  so another copy of an executed procedure (a later migration, a docs copy)
  does not make its own candidate a writer either.
- When several files define the procedure, the executing candidate takes on
  the bodies of all its production copies (outside test files and `docs`,
  `doc` or `documentation` folders), or the winner's body alone when no copy is
  production. Docs and test copies of a procedure that has a production copy
  add nothing.
- A procedure that no candidate executes credits the candidate that holds its
  script: with several copies, the candidate of each production copy (or of
  the winner when no copy is production), and each takes on all those bodies.
  Test files and unclustered files are not candidates, so a procedure that only
  tests or unclustered code run still shows up under the script's candidate.

## Coverage with SQL scripts

At the default `contextsView.weights.data` of 0, a `.sql` file joins a
candidate only through co-change. Scripts that never change together with other
files are listed as unclustered and lower `coverage`, so a SQL-heavy repository
can show a noticeably lower ratio (0.91 instead of 0.99 on one production
fixture, with the candidates unchanged). To leave such scripts out of the view,
add them to `contextsView.exclude`.

## Collisions and SQL tables

A table takes part in collisions with its columns as members, and names compare
with ASCII case and `_` ignored. A C# entity class and the table of the same
name (`LoanItems` and `dbo.loan_items`) can therefore show up as a collision
when the class's members differ from the columns. Such an entry usually means an
entity mapped to its table, not two meanings of one term, so treat it as
possible noise.

## JSON output shape

`--json` prints the whole artifact, including the settings that produced it and
the full member lists (the MCP tool caps these).

```json
{
  "version": 1,
  "commitSha": "857052d",
  "settings": { "weights": { "dependency": 1, "coChange": 1, "data": 0 }, "resolution": 1, "minCandidateFiles": 3 },
  "coverage": { "files": 124, "covered": 118, "ratio": 0.952 },
  "candidates": [
    {
      "id": 1,
      "label": "src/billing",
      "fingerprint": "9f2c1a7e04b3d856",
      "fileCount": 52,
      "files": ["src/billing/invoice.ts", "src/billing/ledger.ts"],
      "cohesion": 0.81,
      "topTerms": [{ "term": "invoice", "files": 21 }, { "term": "payment", "files": 14 }],
      "crossEdges": [{ "candidate": 3, "total": 17, "byKind": { "imports": 12, "calls": 5 } }],
      "coChangePairs": [
        { "file": "src/billing/invoice.ts", "otherFile": "src/accounts/customer.ts", "otherCandidate": 2, "frequency": 0.4, "sharedCommits": 6 }
      ],
      "sharedTables": []
    }
  ],
  "hubs": [
    { "file": "src/shared/db-factory.ts", "reasons": ["fan-in", "god-node"], "dependents": 48, "damping": 0.172, "candidate": 3 }
  ],
  "unclustered": { "count": 6, "files": ["src/legacy/old-script.ts"] },
  "collisions": [
    {
      "name": "Customer",
      "minJaccard": 0.1,
      "occurrences": [
        { "candidate": 1, "file": "src/billing/customer.ts", "symbolId": "src/billing/customer.ts::Customer::class", "members": ["id", "billingAddress"] },
        { "candidate": 2, "file": "src/accounts/customer.ts", "symbolId": "src/accounts/customer.ts::Customer::class", "members": ["id", "email", "status"] }
      ]
    }
  ],
  "dataResources": []
}
```

The example is abbreviated (`settings` also holds `exclude`, `hubs` and
`technicalTerms`). With data coupling, `dataResources` lists every table or
view a candidate file (members and assigned hubs) reads or writes, and each
candidate's `sharedTables` lists the ones it shares with another candidate:

```json
{
  "dataResources": [
    {
      "name": "dbo.loanevents",
      "external": true,
      "accesses": [{ "candidate": 1, "modes": ["writes"] }],
      "writers": [1],
      "owner": 1
    },
    {
      "name": "dbo.loans",
      "kind": "table",
      "external": false,
      "accesses": [
        { "candidate": 1, "modes": ["reads", "writes"] },
        { "candidate": 2, "modes": ["reads"] }
      ],
      "writers": [1],
      "owner": 1
    }
  ]
}
```

`kind` is absent and `external` is `true` when no indexed `.sql` file defines
the resource; `owner` is set only when exactly one candidate writes it. The
artifact keeps the full lists. A table shared by k candidates appears under
each of them with all k accesses, so the file grows with k² for widely shared
tables; the MCP tool caps what it returns (see
[`get_architectural_overlay`](/mcp-tools/get-architectural-overlay#data-coupling)). The settings are described under
[`contextsView` in the config reference](/reference/config-schema#contextsview).
`fingerprint` is a hash of the sorted members, so it stays the same when
candidates are renumbered. The file has no timestamp: the same index, config and
commit always produce byte-identical output.

## No view yet

If `contexts-view.json` is missing or unreadable, the table mode prints
`No contexts view. Run ctxo index (without --skip-community).` to stderr, and
`--json` prints `{"found":false,"hint":"..."}` to stdout. Both exit `0`.

## When the view is refreshed

- On every `ctxo index` run that re-indexes files, full or incremental (`--files`,
  `--commit`), and on every post-commit hook run. A run with nothing to re-index
  does not rewrite it.
- Not on `ctxo index --skip-community`.
- Not by [`ctxo watch`](./watch.md). Run `ctxo index` after a long watch session
  before reading the view.

## Examples

::: code-group
```shell [table]
ctxo contexts
```

```shell [full artifact]
ctxo contexts --json > contexts-view.json
```

```shell [jq: sizes]
ctxo contexts --json | jq '.candidates[] | { id, label, fileCount, cohesion }'
```

```shell [jq: collisions]
ctxo contexts --json | jq '.collisions[] | { name, minJaccard, candidates: [.occurrences[].candidate] }'
```
:::

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Always, including when no view exists |

## See also

- [`ctxo index`](./index.md) - computes the view.
- [`get_architectural_overlay`](/mcp-tools/get-architectural-overlay) - the same data over MCP (`mode: "contexts"`).
- [config.yaml reference](/reference/config-schema#contextsview) - tune `contextsView`.
