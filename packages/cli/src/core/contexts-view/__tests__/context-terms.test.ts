import { describe, it, expect } from 'vitest';
import { findTermCollisions, harvestTopTerms } from '../context-terms.js';
import { DEFAULT_TECHNICAL_TERMS } from '../../config/config-schema.js';
import type { SymbolKind, SymbolNode } from '../../types.js';

function sym(file: string, name: string, kind: SymbolKind): SymbolNode {
  return { symbolId: `${file}::${name}::${kind}`, name, kind, startLine: 1, endLine: 2 };
}

function byFile(entries: Record<string, SymbolNode[]>): Map<string, readonly SymbolNode[]> {
  return new Map(Object.entries(entries));
}

/** A lang-sql table symbol: canonical name in the ID, declared spelling as the name, columns as an annotation. */
function table(file: string, canonical: string, declared: string, columns: string[]): SymbolNode {
  return {
    symbolId: `${file}::${canonical}::table`,
    name: declared,
    kind: 'table',
    startLine: 1,
    endLine: 2,
    ...(columns.length > 0 ? { annotations: [{ name: 'columns', args: columns }] } : {}),
  };
}

function view(file: string, canonical: string, declared: string): SymbolNode {
  return { symbolId: `${file}::${canonical}::view`, name: declared, kind: 'view', startLine: 1, endLine: 2 };
}

describe('data resource terms', () => {
  it('table names and columns join the top terms', () => {
    const symbols = byFile({
      'db/loans.sql': [table('db/loans.sql', 'dbo.loanitems', 'dbo.LoanItems', ['due_date', 'fine_amount'])],
      'db/members.sql': [table('db/members.sql', 'dbo.member_cards', 'member_cards', [])],
      'src/Lending/Loan.cs': [sym('src/Lending/Loan.cs', 'Lending.Loan', 'class')],
    });
    expect(harvestTopTerms(['db/loans.sql', 'db/members.sql', 'src/Lending/Loan.cs'], symbols, DEFAULT_TECHNICAL_TERMS)).toEqual([
      { term: 'loan', files: 2 },
      { term: 'amount', files: 1 },
      { term: 'cards', files: 1 },
      { term: 'date', files: 1 },
      { term: 'due', files: 1 },
      { term: 'fine', files: 1 },
      { term: 'items', files: 1 },
      { term: 'member', files: 1 },
    ]);
  });

  it('a table and a class of the same name with different shapes collide', () => {
    const symbols = byFile({
      'src/Billing/Loans.cs': [
        sym('src/Billing/Loans.cs', 'Billing.Loans', 'class'),
        sym('src/Billing/Loans.cs', 'Billing.Loans.Total', 'method'),
        sym('src/Billing/Loans.cs', 'Billing.Loans.Currency', 'variable'),
      ],
      'db/loans.sql': [table('db/loans.sql', 'dbo.loans', 'dbo.Loans', ['amount', 'member_id'])],
    });
    expect(
      findTermCollisions([{ id: 1, files: ['src/Billing/Loans.cs'] }, { id: 2, files: ['db/loans.sql'] }], symbols),
    ).toEqual([
      {
        name: 'loans',
        minJaccard: 0,
        occurrences: [
          {
            candidate: 1,
            file: 'src/Billing/Loans.cs',
            symbolId: 'src/Billing/Loans.cs::Billing.Loans::class',
            members: ['Currency', 'Total'],
          },
          { candidate: 2, file: 'db/loans.sql', symbolId: 'db/loans.sql::dbo.loans::table', members: ['amount', 'member_id'] },
        ],
      },
    ]);
  });

  it('member names compare without case and underscores', () => {
    const cls = (members: string[]) => [
      sym('src/Lending/LoanItems.cs', 'Lending.LoanItems', 'class'),
      ...members.map((member) => sym('src/Lending/LoanItems.cs', `Lending.LoanItems.${member}`, 'variable')),
    ];
    const sources = [
      { id: 1, files: ['src/Lending/LoanItems.cs'] },
      { id: 2, files: ['db/loan_items.sql'] },
    ];
    const tableSymbols = [table('db/loan_items.sql', 'dbo.loan_items', 'loan_items', ['due_date', 'member_id'])];

    // MemberId matches member_id and DueDate matches due_date: the same shape, no collision.
    expect(
      findTermCollisions(sources, byFile({ 'src/Lending/LoanItems.cs': cls(['DueDate', 'MemberId']), 'db/loan_items.sql': tableSymbols })),
    ).toEqual([]);

    // Two of five normalized names shared: 0.4. The key drops case and `_`; members keep their spelling.
    const result = findTermCollisions(
      sources,
      byFile({
        'src/Lending/LoanItems.cs': cls(['DueDate', 'Fee', 'MemberId']),
        'db/loan_items.sql': [table('db/loan_items.sql', 'dbo.loan_items', 'loan_items', ['amount', 'due_date', 'fine', 'member_id'])],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('loanitems');
    expect(result[0]!.minJaccard).toBe(0.4);
    expect(result[0]!.occurrences.map((o) => o.members)).toEqual([
      ['DueDate', 'Fee', 'MemberId'],
      ['amount', 'due_date', 'fine', 'member_id'],
    ]);

    // The similarity function receives the normalized names.
    const seen: Array<readonly string[]> = [];
    findTermCollisions(
      sources,
      byFile({ 'src/Lending/LoanItems.cs': cls(['MemberId']), 'db/loan_items.sql': tableSymbols }),
      (a, b) => {
        seen.push(a, b);
        return 0;
      },
    );
    expect(seen).toEqual([['memberid'], ['duedate', 'memberid']]);
  });

  it('views appear in top terms but not in collisions', () => {
    const symbols = byFile({
      'src/Billing/Loans.cs': [
        sym('src/Billing/Loans.cs', 'Billing.Loans', 'class'),
        sym('src/Billing/Loans.cs', 'Billing.Loans.Total', 'method'),
      ],
      'db/open_loans.sql': [view('db/open_loans.sql', 'dbo.loans', 'dbo.Loans')],
    });
    expect(harvestTopTerms(['db/open_loans.sql'], symbols, DEFAULT_TECHNICAL_TERMS)).toEqual([{ term: 'loans', files: 1 }]);
    expect(
      findTermCollisions([{ id: 1, files: ['src/Billing/Loans.cs'] }, { id: 2, files: ['db/open_loans.sql'] }], symbols),
    ).toEqual([]);
  });
});

describe('harvestTopTerms', () => {
  it('ranks type-name tokens by number of files', () => {
    const symbols = byFile({
      'f1.ts': [sym('f1.ts', 'LoanPolicy', 'class')],
      'f2.ts': [sym('f2.ts', 'LoanLimit', 'type')],
      'f3.ts': [sym('f3.ts', 'MemberAccount', 'interface')],
    });
    expect(harvestTopTerms(['f1.ts', 'f2.ts', 'f3.ts'], symbols, DEFAULT_TECHNICAL_TERMS)).toEqual([
      { term: 'loan', files: 2 },
      { term: 'account', files: 1 },
      { term: 'limit', files: 1 },
      { term: 'member', files: 1 },
      { term: 'policy', files: 1 },
    ]);
  });

  it('drops stop words, technical words, the interface I prefix and short or numeric tokens', () => {
    const symbols = byFile({
      'f1.ts': [sym('f1.ts', 'ILoanRepository', 'interface'), sym('f1.ts', 'LoanService', 'class')],
      'f2.ts': [sym('f2.ts', 'GetHandler2', 'class')],
    });
    expect(harvestTopTerms(['f1.ts', 'f2.ts'], symbols, DEFAULT_TECHNICAL_TERMS)).toEqual([
      { term: 'loan', files: 1 },
    ]);
  });

  it('includes enum members of type symbols', () => {
    const symbols = byFile({
      'f1.cs': [sym('f1.cs', 'Ns.LoanStatus', 'type'), sym('f1.cs', 'Ns.LoanStatus.Overdue', 'variable')],
    });
    expect(harvestTopTerms(['f1.cs'], symbols, DEFAULT_TECHNICAL_TERMS)).toEqual([
      { term: 'loan', files: 1 },
      { term: 'overdue', files: 1 },
      { term: 'status', files: 1 },
    ]);
  });

  it('keeps the top 10 with code point tie-breaks', () => {
    const names = ['Kilo', 'Juliet', 'India', 'Hotel', 'Golf', 'Foxtrot', 'Echo', 'Delta', 'Charlie', 'Bravo', 'Alpha', 'Zulu'];
    const symbols = byFile({ 'f1.ts': names.map((n) => sym('f1.ts', n, 'class')) });
    const terms = harvestTopTerms(['f1.ts'], symbols, DEFAULT_TECHNICAL_TERMS);
    expect(terms.map((t) => t.term)).toEqual([
      'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet',
    ]);
    expect(harvestTopTerms(['f1.ts'], symbols, DEFAULT_TECHNICAL_TERMS, 3)).toHaveLength(3);
  });

  it('takes terms from type names and enum members only, not class members', () => {
    const symbols = byFile({
      'f1.cs': [
        sym('f1.cs', 'Ns.Account', 'class'),
        sym('f1.cs', 'Ns.Account.Borrow', 'method'),
        sym('f1.cs', 'Ns.Account.MemberId', 'variable'),
      ],
    });
    expect(harvestTopTerms(['f1.cs'], symbols, DEFAULT_TECHNICAL_TERMS)).toEqual([
      { term: 'account', files: 1 },
    ]);
  });

  it('counts a term that appears twice in one file once', () => {
    const symbols = byFile({
      'f1.ts': [sym('f1.ts', 'LoanPolicy', 'class'), sym('f1.ts', 'LoanLimit', 'type')],
    });
    const terms = harvestTopTerms(['f1.ts'], symbols, DEFAULT_TECHNICAL_TERMS);
    expect(terms.find((t) => t.term === 'loan')).toEqual({ term: 'loan', files: 1 });
  });

  it('uses the supplied technical term list instead of the default', () => {
    const symbols = byFile({ 'f1.ts': [sym('f1.ts', 'LoanService', 'class')] });
    expect(harvestTopTerms(['f1.ts'], symbols, ['Loan']).map((t) => t.term)).toEqual(['service']);
  });
});

describe('findTermCollisions', () => {
  it('reports a name whose shapes differ across candidates', () => {
    const symbols = byFile({
      'a.cs': [
        sym('a.cs', 'Lending.Account', 'class'),
        sym('a.cs', 'Lending.Account.MemberId', 'variable'),
        sym('a.cs', 'Lending.Account.Borrow', 'method'),
        sym('a.cs', 'Lending.Account.Limit', 'variable'),
      ],
      'b.cs': [
        sym('b.cs', 'Billing.Account', 'class'),
        sym('b.cs', 'Billing.Account.PayerId', 'variable'),
        sym('b.cs', 'Billing.Account.Charge', 'method'),
        sym('b.cs', 'Billing.Account.Limit', 'variable'),
      ],
    });
    const result = findTermCollisions(
      [{ id: 1, files: ['a.cs'] }, { id: 2, files: ['b.cs'] }],
      symbols,
    );
    expect(result).toEqual([
      {
        name: 'account',
        minJaccard: 0.2,
        occurrences: [
          { candidate: 1, file: 'a.cs', symbolId: 'a.cs::Lending.Account::class', members: ['Borrow', 'Limit', 'MemberId'] },
          { candidate: 2, file: 'b.cs', symbolId: 'b.cs::Billing.Account::class', members: ['Charge', 'Limit', 'PayerId'] },
        ],
      },
    ]);
  });

  it('ignores Jaccard >= 0.5, names inside a single candidate and two empty member sets', () => {
    const symbols = byFile({
      'a.ts': [sym('a.ts', 'Same', 'class'), sym('a.ts', 'Same.x', 'method'), sym('a.ts', 'Same.y', 'method'),
        sym('a.ts', 'Empty', 'class'), sym('a.ts', 'Lone', 'class')],
      'b.ts': [sym('b.ts', 'Same', 'class'), sym('b.ts', 'Same.x', 'method'), sym('b.ts', 'Same.y', 'method'),
        sym('b.ts', 'Same.z', 'method'), sym('b.ts', 'Empty', 'class')],
    });
    // Same: 2/3 >= 0.5; Empty: two empty sets are identical; Lone: present in candidate 1 only.
    expect(findTermCollisions([{ id: 1, files: ['a.ts'] }, { id: 2, files: ['b.ts'] }], symbols)).toEqual([]);
    // Everything inside a single candidate is never a collision, even with different shapes.
    const single = byFile({
      'a.ts': [sym('a.ts', 'Dup', 'class'), sym('a.ts', 'Dup.x', 'method')],
      'b.ts': [sym('b.ts', 'Dup', 'class'), sym('b.ts', 'Dup.y', 'method')],
    });
    expect(findTermCollisions([{ id: 1, files: ['a.ts', 'b.ts'] }], single)).toEqual([]);
  });

  it('collapses arity-suffixed overloads so they match Roslyn-style member names', () => {
    const symbols = byFile({
      'a.cs': [
        sym('a.cs', 'Lending.Account', 'class'),
        sym('a.cs', 'Lending.Account.Borrow(1)', 'method'),
        sym('a.cs', 'Lending.Account.Borrow(2)', 'method'),
      ],
      'b.cs': [sym('b.cs', 'Billing.Account', 'class'), sym('b.cs', 'Billing.Account.Borrow', 'method')],
    });
    expect(findTermCollisions([{ id: 1, files: ['a.cs'] }, { id: 2, files: ['b.cs'] }], symbols)).toEqual([]);
    const withMembers = byFile({
      'a.cs': [
        sym('a.cs', 'Lending.Account', 'class'),
        sym('a.cs', 'Lending.Account.Borrow(1)', 'method'),
        sym('a.cs', 'Lending.Account.Borrow(2)', 'method'),
        sym('a.cs', 'Lending.Account.Pay(0)', 'method'),
      ],
      'b.cs': [sym('b.cs', 'Billing.Account', 'class')],
    });
    const result = findTermCollisions([{ id: 1, files: ['a.cs'] }, { id: 2, files: ['b.cs'] }], withMembers);
    expect(result[0]!.occurrences[0]!.members).toEqual(['Borrow', 'Pay']);
  });

  it('excludes deeper names from member sets', () => {
    const symbols = byFile({
      'a.ts': [sym('a.ts', 'Acct', 'class'), sym('a.ts', 'Acct.Inner.x', 'variable'), sym('a.ts', 'Acct.y', 'method')],
      'b.ts': [sym('b.ts', 'Acct', 'class'), sym('b.ts', 'Acct.z', 'method')],
    });
    const result = findTermCollisions([{ id: 1, files: ['a.ts'] }, { id: 2, files: ['b.ts'] }], symbols);
    expect(result[0]!.occurrences[0]!.members).toEqual(['y']);
  });

  it('rounds minJaccard to 3 decimals', () => {
    const symbols = byFile({
      'a.ts': [sym('a.ts', 'Acct', 'class'), sym('a.ts', 'Acct.a', 'method'), sym('a.ts', 'Acct.b', 'method')],
      'b.ts': [sym('b.ts', 'Acct', 'class'), sym('b.ts', 'Acct.b', 'method'), sym('b.ts', 'Acct.c', 'method')],
    });
    const result = findTermCollisions([{ id: 1, files: ['a.ts'] }, { id: 2, files: ['b.ts'] }], symbols);
    expect(result[0]!.minJaccard).toBe(0.333);
  });

  /** `count` files each declaring `Order`, spread over four candidates; `members(i)` names the members of file i. */
  function orderGroup(count: number, members: (i: number) => string[]) {
    const entries: Record<string, SymbolNode[]> = {};
    const files: string[][] = [[], [], [], []];
    for (let i = 0; i < count; i++) {
      const file = `f${String(i).padStart(3, '0')}.ts`;
      entries[file] = [
        sym(file, 'Order', 'class'),
        ...members(i).map((member) => sym(file, `Order.${member}`, 'method')),
      ];
      files[i % 4]!.push(file);
    }
    return { symbols: byFile(entries), candidates: files.map((list, i) => ({ id: i + 1, files: list })) };
  }

  it('a large same-name group still gives minJaccard 0 when only its last occurrence shares no member', () => {
    // Every pair of the first 199 shares `id` and differs in one member (Jaccard 1/3); the last one shares nothing.
    const { symbols, candidates } = orderGroup(200, (i) => (i === 199 ? ['weight'] : ['id', `m${i}`]));

    const result = findTermCollisions(candidates, symbols);

    expect(result).toHaveLength(1);
    expect(result[0]!.minJaccard).toBe(0);
    expect(result[0]!.occurrences).toHaveLength(200);
  });

  it('stops comparing a group once a pair of occurrences shares no member', () => {
    const { symbols, candidates } = orderGroup(200, (i) => [`m${i}`]);
    let compared = 0;
    const disjoint = (): number => {
      compared++;
      return 0;
    };

    const result = findTermCollisions(candidates, symbols, disjoint);

    expect(result[0]!.minJaccard).toBe(0);
    expect(compared).toBe(1);
  });

  it('matches names case-insensitively', () => {
    const symbols = byFile({
      'a.ts': [sym('a.ts', 'Account', 'class'), sym('a.ts', 'Account.one', 'method')],
      'b.ts': [sym('b.ts', 'ACCOUNT', 'class'), sym('b.ts', 'ACCOUNT.two', 'method')],
    });
    const result = findTermCollisions([{ id: 1, files: ['a.ts'] }, { id: 2, files: ['b.ts'] }], symbols);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('account');
    expect(result[0]!.minJaccard).toBe(0);
  });
});
