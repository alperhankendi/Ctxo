import { describe, expect, it, vi } from 'vitest';

import type { EdgeKind, FileIndex, SymbolKind, SymbolNode } from '../../types.js';
import { computeDataCoupling } from '../data-coupling.js';
import { buildIndexGraph } from '../file-graph.js';

type Edge = [from: string, to: string, kind: EdgeKind];

function sym(file: string, name: string, kind: SymbolKind): SymbolNode {
  return { symbolId: `${file}::${name}::${kind}`, name, kind, startLine: 1, endLine: 2 };
}

function fileIndex(file: string, symbols: SymbolNode[], edges: Edge[] = []): FileIndex {
  return {
    file,
    lastModified: 1,
    symbols,
    edges: edges.map(([from, to, kind]) => ({ from, to, kind })),
    intent: [],
    antiPatterns: [],
  };
}

/** A C# file with one method `<Type>.Run` whose data edges go to the given targets. */
function cs(file: string, accesses: Array<[to: string, kind: EdgeKind]>): FileIndex {
  const type = file.slice(file.lastIndexOf('/') + 1).replace(/\.cs$/, '');
  const method = sym(file, `Lending.${type}.Run`, 'method');
  return fileIndex(
    file,
    [sym(file, `Lending.${type}`, 'class'), method],
    accesses.map(([to, kind]): Edge => [method.symbolId, to, kind]),
  );
}

/** A .sql file with the given definitions (canonical names) and edges from them. */
function sql(file: string, defs: Array<[name: string, kind: SymbolKind]>, edges: Array<[from: string, to: string, kind: EdgeKind]> = []): FileIndex {
  return fileIndex(
    file,
    defs.map(([name, kind]) => sym(file, name, kind)),
    edges.map(([from, to, kind]): Edge => {
      const def = defs.find(([name]) => name === from)!;
      return [`${file}::${def[0]}::${def[1]}`, to, kind];
    }),
  );
}

function coupling(indices: FileIndex[], fileCandidate: Array<[string, number]>) {
  return computeDataCoupling({ graph: buildIndexGraph(indices), fileCandidate: new Map(fileCandidate) });
}

const LOANS_SQL = sql('db/loans.sql', [['dbo.loans', 'table']]);
const MEMBERS_SQL = sql('db/members.sql', [['dbo.members', 'table']]);

describe('computeDataCoupling', () => {
  it('a table read by two candidates is shared, with each candidate\'s modes', () => {
    const result = coupling(
      [
        LOANS_SQL,
        cs('src/billing/Invoice.cs', [
          ['dbo.loans::table', 'reads'],
          ['dbo.loans::table', 'writes'],
        ]),
        cs('src/shipping/Parcel.cs', [['dbo.loans::table', 'reads']]),
      ],
      [
        ['src/billing/Invoice.cs', 1],
        ['src/shipping/Parcel.cs', 2],
      ],
    );

    const accesses = [
      { candidate: 1, modes: ['reads', 'writes'] },
      { candidate: 2, modes: ['reads'] },
    ];
    expect(result.resources).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses, writers: [1], owner: 1 },
    ]);
    const shared = [{ name: 'dbo.loans', kind: 'table', external: false, accesses, owner: 1 }];
    expect(result.sharedTables.get(1)).toEqual(shared);
    expect(result.sharedTables.get(2)).toEqual(shared);
  });

  it('writes through a procedure count for the executing candidate', () => {
    const result = coupling(
      [
        LOANS_SQL,
        sql('db/close.sql', [['dbo.usp_close', 'procedure']], [['dbo.usp_close', 'dbo.loans::table', 'writes']]),
        cs('src/billing/Close.cs', [['dbo.usp_close::procedure', 'executes']]),
      ],
      [
        ['src/billing/Close.cs', 1],
        ['db/close.sql', 2],
      ],
    );

    expect(result.resources).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses: [{ candidate: 1, modes: ['writes'] }], writers: [1], owner: 1 },
    ]);
    expect(result.sharedTables.size).toBe(0);
  });

  it('a procedure\'s accesses count for the candidates that execute it, not for the candidate holding its script', () => {
    const result = coupling(
      [
        LOANS_SQL,
        MEMBERS_SQL,
        sql(
          'db/close.sql',
          [['dbo.usp_close', 'procedure']],
          [
            ['dbo.usp_close', 'dbo.loans::table', 'writes'],
            ['dbo.usp_close', 'dbo.members::table', 'reads'],
          ],
        ),
        cs('src/billing/Close.cs', [['dbo.usp_close::procedure', 'executes']]),
        cs('src/shipping/Parcel.cs', [['dbo.members::table', 'reads']]),
      ],
      [
        ['src/billing/Close.cs', 1],
        ['db/close.sql', 2],
        ['db/loans.sql', 2],
        ['src/shipping/Parcel.cs', 2],
      ],
    );

    expect(result.resources).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses: [{ candidate: 1, modes: ['writes'] }], writers: [1], owner: 1 },
      {
        name: 'dbo.members',
        kind: 'table',
        external: false,
        accesses: [
          { candidate: 1, modes: ['reads'] },
          { candidate: 2, modes: ['reads'] },
        ],
        writers: [],
      },
    ]);
    expect(result.sharedTables.get(1)!.map((table) => table.name)).toEqual(['dbo.members']);
    expect(result.sharedTables.get(2)!.map((table) => table.name)).toEqual(['dbo.members']);
  });

  it('a procedure nobody executes still credits its own candidate', () => {
    const result = coupling(
      [
        LOANS_SQL,
        MEMBERS_SQL,
        sql('db/purge.sql', [['dbo.usp_purge', 'procedure']], [
          ['dbo.usp_purge', 'dbo.loans::table', 'writes'],
          ['dbo.usp_purge', 'dbo.usp_log::procedure', 'executes'],
        ]),
        // Executed through usp_purge, so it counts for usp_purge's candidate, not for its own.
        sql('db/log.sql', [['dbo.usp_log', 'procedure']], [['dbo.usp_log', 'dbo.members::table', 'writes']]),
        cs('src/billing/Invoice.cs', [['dbo.loans::table', 'reads']]),
      ],
      [
        ['src/billing/Invoice.cs', 1],
        ['db/purge.sql', 2],
        ['db/log.sql', 3],
      ],
    );

    expect(result.resources).toEqual([
      {
        name: 'dbo.loans',
        kind: 'table',
        external: false,
        accesses: [
          { candidate: 1, modes: ['reads'] },
          { candidate: 2, modes: ['writes'] },
        ],
        writers: [2],
        owner: 2,
      },
      { name: 'dbo.members', kind: 'table', external: false, accesses: [{ candidate: 2, modes: ['writes'] }], writers: [2], owner: 2 },
    ]);
  });

  it('procedures that only execute each other credit their own candidates', () => {
    const result = coupling(
      [
        LOANS_SQL,
        MEMBERS_SQL,
        sql('db/a.sql', [['dbo.usp_a', 'procedure']], [
          ['dbo.usp_a', 'dbo.usp_b::procedure', 'executes'],
          ['dbo.usp_a', 'dbo.loans::table', 'writes'],
        ]),
        sql('db/b.sql', [['dbo.usp_b', 'procedure']], [
          ['dbo.usp_b', 'dbo.usp_a::procedure', 'executes'],
          ['dbo.usp_b', 'dbo.members::table', 'reads'],
        ]),
      ],
      [
        ['db/a.sql', 1],
        ['db/b.sql', 2],
      ],
    );

    // Nothing outside the cycle executes it, so both keep crediting their own candidate, as before.
    const both = (mode: 'reads' | 'writes') => [
      { candidate: 1, modes: [mode] },
      { candidate: 2, modes: [mode] },
    ];
    expect(result.resources).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses: both('writes'), writers: [1, 2] },
      { name: 'dbo.members', kind: 'table', external: false, accesses: both('reads'), writers: [] },
    ]);
  });

  it('a superseded procedure copy does not make its own candidate a writer', () => {
    const closeScript = (file: string) =>
      sql(file, [['dbo.usp_close', 'procedure']], [['dbo.usp_close', 'dbo.loans::table', 'writes']]);
    const result = coupling(
      [
        LOANS_SQL,
        closeScript('db/migrations/V1__init.sql'),
        // Loses resolution to V1, so no executes edge points at it.
        closeScript('db/migrations/V7__close_fix.sql'),
        cs('src/billing/Close.cs', [['dbo.usp_close::procedure', 'executes']]),
      ],
      [
        ['src/billing/Close.cs', 0],
        ['db/migrations/V1__init.sql', 1],
        ['db/migrations/V7__close_fix.sql', 1],
      ],
    );

    expect(result.resources).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses: [{ candidate: 0, modes: ['writes'] }], writers: [0], owner: 0 },
    ]);
  });

  it('an executor takes the union of the production copies of a procedure', () => {
    // V1 wins resolution; V7 is another production copy, so its body counts too, chain included.
    const result = coupling(
      [
        LOANS_SQL,
        sql('db/audit.sql', [['dbo.audit', 'table']]),
        sql('db/migrations/V1__init.sql', [['dbo.usp_close', 'procedure']], [['dbo.usp_close', 'dbo.loans::table', 'writes']]),
        sql('db/migrations/V7__close_fix.sql', [['dbo.usp_close', 'procedure']], [
          ['dbo.usp_close', 'dbo.loans::table', 'writes'],
          ['dbo.usp_close', 'dbo.audit::table', 'writes'],
          ['dbo.usp_close', 'dbo.usp_log::procedure', 'executes'],
        ]),
        sql('db/log.sql', [['dbo.usp_log', 'procedure']], [['dbo.usp_log', 'dbo.members::table', 'writes']]),
        MEMBERS_SQL,
        cs('src/billing/Close.cs', [['dbo.usp_close::procedure', 'executes']]),
      ],
      [
        ['src/billing/Close.cs', 0],
        ['db/migrations/V1__init.sql', 1],
        ['db/migrations/V7__close_fix.sql', 1],
        ['db/log.sql', 2],
      ],
    );

    const writtenBy0 = { kind: 'table', external: false, accesses: [{ candidate: 0, modes: ['writes'] }], writers: [0], owner: 0 };
    expect(result.resources).toEqual([
      { name: 'dbo.audit', ...writtenBy0 },
      { name: 'dbo.loans', ...writtenBy0 },
      { name: 'dbo.members', ...writtenBy0 },
    ]);
  });

  it('docs and test copies of a procedure add nothing when a production copy exists', () => {
    const result = coupling(
      [
        LOANS_SQL,
        MEMBERS_SQL,
        sql('db/audit.sql', [['dbo.audit', 'table']]),
        sql('db/fines.sql', [['dbo.fines', 'table']]),
        sql('db/procs/close.sql', [['dbo.usp_close', 'procedure']], [['dbo.usp_close', 'dbo.loans::table', 'writes']]),
        // A docs copy and a test copy, each with a body the production copy does not have.
        sql('docs/db/close.sql', [['dbo.usp_close', 'procedure']], [
          ['dbo.usp_close', 'dbo.audit::table', 'writes'],
          ['dbo.usp_close', 'dbo.usp_log::procedure', 'executes'],
        ]),
        sql('src/Lending.Tests/db/close.sql', [['dbo.usp_close', 'procedure']], [['dbo.usp_close', 'dbo.members::table', 'writes']]),
        // Only the docs copy executes it, so nobody does, and it credits its own candidate.
        sql('db/procs/log.sql', [['dbo.usp_log', 'procedure']], [['dbo.usp_log', 'dbo.fines::table', 'writes']]),
        cs('src/billing/Close.cs', [['dbo.usp_close::procedure', 'executes']]),
      ],
      [
        ['src/billing/Close.cs', 0],
        ['db/procs/close.sql', 1],
        ['docs/db/close.sql', 2],
        ['src/Lending.Tests/db/close.sql', 3],
        ['db/procs/log.sql', 4],
      ],
    );

    expect(result.resources).toEqual([
      { name: 'dbo.fines', kind: 'table', external: false, accesses: [{ candidate: 4, modes: ['writes'] }], writers: [4], owner: 4 },
      { name: 'dbo.loans', kind: 'table', external: false, accesses: [{ candidate: 0, modes: ['writes'] }], writers: [0], owner: 0 },
    ]);
  });

  it('a procedure nobody executes credits only the candidates of its production copies', () => {
    const result = coupling(
      [
        LOANS_SQL,
        sql('db/migrations/V1__init.sql', [['dbo.usp_purge', 'procedure']], [['dbo.usp_purge', 'dbo.loans::table', 'writes']]),
        sql('db/jobs/purge.sql', [['dbo.usp_purge', 'procedure']], [['dbo.usp_purge', 'dbo.loans::table', 'writes']]),
        sql('docs/db/purge.sql', [['dbo.usp_purge', 'procedure']], [['dbo.usp_purge', 'dbo.loans::table', 'writes']]),
        sql('src/Lending.Tests/db/purge.sql', [['dbo.usp_purge', 'procedure']], [['dbo.usp_purge', 'dbo.loans::table', 'writes']]),
      ],
      [
        ['db/migrations/V1__init.sql', 1],
        ['db/jobs/purge.sql', 2],
        ['docs/db/purge.sql', 3],
        ['src/Lending.Tests/db/purge.sql', 4],
      ],
    );

    expect(result.resources).toEqual([
      {
        name: 'dbo.loans',
        kind: 'table',
        external: false,
        accesses: [
          { candidate: 1, modes: ['writes'] },
          { candidate: 2, modes: ['writes'] },
        ],
        writers: [1, 2],
      },
    ]);
  });

  it('a procedure defined only in a docs file still credits its executor', () => {
    const result = coupling(
      [
        LOANS_SQL,
        sql('docs/db/renew.sql', [['dbo.usp_renew', 'procedure']], [['dbo.usp_renew', 'dbo.loans::table', 'writes']]),
        cs('src/billing/Renew.cs', [['dbo.usp_renew::procedure', 'executes']]),
      ],
      [
        ['src/billing/Renew.cs', 0],
        ['docs/db/renew.sql', 1],
      ],
    );

    // Executed, so the docs file's own candidate takes nothing.
    expect(result.resources).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses: [{ candidate: 0, modes: ['writes'] }], writers: [0], owner: 0 },
    ]);
  });

  it('when no production copy exists, the executor takes the winning copy only', () => {
    const result = coupling(
      [
        LOANS_SQL,
        MEMBERS_SQL,
        sql('docs/db/a.sql', [['dbo.usp_renew', 'procedure']], [['dbo.usp_renew', 'dbo.loans::table', 'writes']]),
        // Another docs copy and a test copy lose to docs/db/a.sql, so their bodies add nothing.
        sql('docs/db/b.sql', [['dbo.usp_renew', 'procedure']], [['dbo.usp_renew', 'dbo.members::table', 'writes']]),
        sql('src/Lending.Tests/db/renew.sql', [['dbo.usp_renew', 'procedure']], [['dbo.usp_renew', 'dbo.members::table', 'reads']]),
        cs('src/billing/Renew.cs', [['dbo.usp_renew::procedure', 'executes']]),
      ],
      [['src/billing/Renew.cs', 0]],
    );

    expect(result.resources).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses: [{ candidate: 0, modes: ['writes'] }], writers: [0], owner: 0 },
    ]);
  });

  it('a procedure executed only from outside the view credits its own candidate', () => {
    const result = coupling(
      [
        LOANS_SQL,
        sql('db/close.sql', [['dbo.usp_close', 'procedure']], [['dbo.usp_close', 'dbo.loans::table', 'writes']]),
        // Unclustered: no candidate, so its executes edge credits nobody.
        cs('src/lonely/Job.cs', [['dbo.usp_close::procedure', 'executes']]),
      ],
      [['db/close.sql', 2]],
    );

    expect(result.resources).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses: [{ candidate: 2, modes: ['writes'] }], writers: [2], owner: 2 },
    ]);
  });

  it('a cycle that an unexecuted procedure enters counts through that procedure', () => {
    const result = coupling(
      [
        LOANS_SQL,
        MEMBERS_SQL,
        sql('db/a.sql', [['dbo.usp_a', 'procedure']], [
          ['dbo.usp_a', 'dbo.usp_b::procedure', 'executes'],
          ['dbo.usp_a', 'dbo.loans::table', 'writes'],
        ]),
        sql('db/b.sql', [['dbo.usp_b', 'procedure']], [
          ['dbo.usp_b', 'dbo.usp_a::procedure', 'executes'],
          ['dbo.usp_b', 'dbo.members::table', 'reads'],
        ]),
        sql('db/nightly.sql', [['dbo.usp_nightly', 'procedure']], [['dbo.usp_nightly', 'dbo.usp_a::procedure', 'executes']]),
      ],
      [
        ['db/a.sql', 1],
        ['db/b.sql', 2],
        ['db/nightly.sql', 3],
      ],
    );

    expect(result.resources).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses: [{ candidate: 3, modes: ['writes'] }], writers: [3], owner: 3 },
      { name: 'dbo.members', kind: 'table', external: false, accesses: [{ candidate: 3, modes: ['reads'] }], writers: [] },
    ]);
  });

  it('the reach step is linear in the number of procedures nobody executes', () => {
    const count = 300;
    const name = (i: number) => `dbo.usp_step${String(i).padStart(4, '0')}`;
    const defs: Array<[string, SymbolKind]> = [];
    const edges: Array<[string, string, EdgeKind]> = [];
    for (let i = 0; i < count; i++) {
      defs.push([name(i), 'procedure']);
      edges.push([name(i), i + 1 < count ? `${name(i + 1)}::procedure` : 'dbo.loans::table', i + 1 < count ? 'executes' : 'writes']);
    }
    const graph = buildIndexGraph([LOANS_SQL, sql('db/steps.sql', defs, edges)]);
    const forward = vi.spyOn(graph, 'getForwardEdges');

    const result = computeDataCoupling({ graph, fileCandidate: new Map([['db/steps.sql', 1]]) });

    // The chain head credits candidate 1, which takes on the whole chain; every other step counts through it.
    expect(result.resources).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses: [{ candidate: 1, modes: ['writes'] }], writers: [1], owner: 1 },
    ]);
    expect(forward.mock.calls.length).toBeLessThanOrEqual(3 * count);
  });

  it('the resource kind comes from the definition SymbolGraph resolves to', () => {
    const result = coupling(
      [
        sql('docs/db/schema.sql', [['dbo.loans', 'view']]),
        sql('src/db/schema.sql', [['dbo.loans', 'table']]),
        cs('src/billing/Invoice.cs', [['dbo.loans::table', 'reads']]),
      ],
      [['src/billing/Invoice.cs', 1]],
    );

    expect(result.resources).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses: [{ candidate: 1, modes: ['reads'] }], writers: [] },
    ]);
  });

  it('procedure chains are followed and cycles terminate', () => {
    const result = coupling(
      [
        LOANS_SQL,
        MEMBERS_SQL,
        sql(
          'db/procs.sql',
          [
            ['dbo.usp_a', 'procedure'],
            ['dbo.usp_b', 'procedure'],
          ],
          [
            ['dbo.usp_a', 'dbo.usp_b::procedure', 'executes'],
            ['dbo.usp_a', 'dbo.loans::table', 'writes'],
            ['dbo.usp_b', 'dbo.usp_a::procedure', 'executes'],
            ['dbo.usp_b', 'dbo.members::table', 'reads'],
          ],
        ),
        cs('src/billing/Renew.cs', [
          ['dbo.usp_a::procedure', 'executes'],
          ['dbo.usp_missing::procedure', 'executes'],
        ]),
      ],
      [['src/billing/Renew.cs', 1]],
    );

    expect(result.resources).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses: [{ candidate: 1, modes: ['writes'] }], writers: [1], owner: 1 },
      { name: 'dbo.members', kind: 'table', external: false, accesses: [{ candidate: 1, modes: ['reads'] }], writers: [] },
    ]);
    expect(result.sharedTables.size).toBe(0);
  });

  it('the only writing candidate is the owner; two writers give no owner', () => {
    const result = coupling(
      [
        LOANS_SQL,
        MEMBERS_SQL,
        cs('src/billing/Invoice.cs', [
          ['dbo.loans::table', 'writes'],
          ['dbo.members::table', 'writes'],
        ]),
        cs('src/shipping/Parcel.cs', [
          ['dbo.loans::table', 'reads'],
          ['dbo.members::table', 'writes'],
        ]),
      ],
      [
        ['src/billing/Invoice.cs', 1],
        ['src/shipping/Parcel.cs', 2],
      ],
    );

    const [loans, members] = result.resources;
    expect(loans!.writers).toEqual([1]);
    expect(loans!.owner).toBe(1);
    expect(members!.writers).toEqual([1, 2]);
    expect('owner' in members!).toBe(false);
    expect(result.sharedTables.get(2)).toEqual([
      { name: 'dbo.loans', kind: 'table', external: false, accesses: loans!.accesses, owner: 1 },
      { name: 'dbo.members', kind: 'table', external: false, accesses: members!.accesses },
    ]);
  });

  it('a reference no .sql file defines is external and has no kind', () => {
    const result = coupling(
      [
        LOANS_SQL,
        cs('src/billing/Audit.cs', [
          ['dbo.audit_log::table', 'writes'],
          ['dbo.loans::table', 'reads'],
        ]),
      ],
      [['src/billing/Audit.cs', 1]],
    );

    expect(result.resources).toEqual([
      { name: 'dbo.audit_log', external: true, accesses: [{ candidate: 1, modes: ['writes'] }], writers: [1], owner: 1 },
      { name: 'dbo.loans', kind: 'table', external: false, accesses: [{ candidate: 1, modes: ['reads'] }], writers: [] },
    ]);
    expect('kind' in result.resources[0]!).toBe(false);
  });

  it('a 2-part table reference to a view resolves to the view', () => {
    const result = coupling(
      [
        LOANS_SQL,
        sql('db/views.sql', [['dbo.open_loans', 'view']], [['dbo.open_loans', 'dbo.loans::table', 'reads']]),
        cs('src/billing/Dunning.cs', [['dbo.open_loans::table', 'reads']]),
      ],
      [['src/billing/Dunning.cs', 1]],
    );

    // Reading a view does not expand to its tables, and the view's own file is unclustered.
    expect(result.resources).toEqual([
      { name: 'dbo.open_loans', kind: 'view', external: false, accesses: [{ candidate: 1, modes: ['reads'] }], writers: [] },
    ]);
  });

  it('unclustered files are ignored and hubs count for their candidate', () => {
    const result = coupling(
      [
        LOANS_SQL,
        cs('src/billing/Invoice.cs', [['dbo.loans::table', 'reads']]),
        cs('src/shared/Db.cs', [['dbo.loans::table', 'writes']]),
        cs('src/lonely/Job.cs', [['dbo.loans::table', 'writes']]),
      ],
      [
        ['src/billing/Invoice.cs', 1],
        ['src/shipping/Parcel.cs', 2],
        // A hub assigned to candidate 2; src/lonely/Job.cs is unclustered and has no entry.
        ['src/shared/Db.cs', 2],
      ],
    );

    expect(result.resources).toEqual([
      {
        name: 'dbo.loans',
        kind: 'table',
        external: false,
        accesses: [
          { candidate: 1, modes: ['reads'] },
          { candidate: 2, modes: ['writes'] },
        ],
        writers: [2],
        owner: 2,
      },
    ]);
  });

  it('reversed input gives deep-equal output', () => {
    const indices = [
      LOANS_SQL,
      MEMBERS_SQL,
      sql('db/views.sql', [['dbo.open_loans', 'view']], [['dbo.open_loans', 'dbo.loans::table', 'reads']]),
      sql(
        'db/procs.sql',
        [
          ['dbo.usp_a', 'procedure'],
          ['dbo.usp_b', 'procedure'],
        ],
        [
          ['dbo.usp_a', 'dbo.usp_b::procedure', 'executes'],
          ['dbo.usp_a', 'dbo.loans::table', 'writes'],
          ['dbo.usp_b', 'dbo.usp_a::procedure', 'executes'],
          ['dbo.usp_b', 'dbo.members::table', 'reads'],
        ],
      ),
      cs('src/billing/Invoice.cs', [
        ['dbo.loans::table', 'reads'],
        ['dbo.open_loans::table', 'reads'],
        ['dbo.audit_log::table', 'writes'],
      ]),
      cs('src/shipping/Parcel.cs', [
        ['dbo.usp_a::procedure', 'executes'],
        ['dbo.members::table', 'writes'],
      ]),
      cs('src/shared/Db.cs', [['dbo.audit_log::table', 'reads']]),
      // A copy of usp_a, and a chain nobody executes (usp_nightly -> usp_purge).
      sql('db/migrations/V2__procs.sql', [['dbo.usp_a', 'procedure']], [['dbo.usp_a', 'dbo.members::table', 'writes']]),
      sql(
        'db/jobs.sql',
        [
          ['dbo.usp_nightly', 'procedure'],
          ['dbo.usp_purge', 'procedure'],
        ],
        [
          ['dbo.usp_nightly', 'dbo.usp_purge::procedure', 'executes'],
          ['dbo.usp_purge', 'dbo.loans::table', 'writes'],
        ],
      ),
    ];
    const fileCandidate: Array<[string, number]> = [
      ['src/billing/Invoice.cs', 1],
      ['src/shipping/Parcel.cs', 2],
      ['src/shared/Db.cs', 2],
      ['db/procs.sql', 1],
      ['db/migrations/V2__procs.sql', 1],
      ['db/jobs.sql', 3],
    ];

    const forward = coupling(indices, fileCandidate);
    const reversed = coupling(
      [...indices]
        .reverse()
        .map((index) => ({ ...index, symbols: [...index.symbols].reverse(), edges: [...index.edges].reverse() })),
      [...fileCandidate].reverse(),
    );

    expect(forward.resources.map((resource) => resource.name)).toEqual([
      'dbo.audit_log',
      'dbo.loans',
      'dbo.members',
      'dbo.open_loans',
    ]);
    expect([...forward.sharedTables.keys()]).toEqual([1, 2, 3]);
    expect(forward.resources.find((resource) => resource.name === 'dbo.loans')!.writers).toEqual([2, 3]);
    expect(reversed).toEqual(forward);
    expect(JSON.stringify(reversed.resources)).toBe(JSON.stringify(forward.resources));
    expect(JSON.stringify([...reversed.sharedTables])).toBe(JSON.stringify([...forward.sharedTables]));
  });
});
