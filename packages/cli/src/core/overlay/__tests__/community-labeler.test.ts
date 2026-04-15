import { describe, it, expect } from 'vitest';
import { labelCommunities } from '../community-labeler.js';

describe('labelCommunities', () => {
  it('returns empty map for no communities', () => {
    const result = labelCommunities(new Map(), new Map());
    expect(result.size).toBe(0);
  });

  it('labels by common path prefix when available', () => {
    const members = new Map<number, string[]>([
      [0, ['src/auth/login.ts::login::function', 'src/auth/session.ts::Session::class']],
    ]);
    const labels = labelCommunities(members, new Map());
    expect(labels.get(0)).toBe('src/auth');
  });

  it('falls back to top-pagerank symbol name when no common prefix', () => {
    const members = new Map<number, string[]>([
      [0, ['alpha.ts::Alpha::function', 'beta.ts::Beta::function']],
    ]);
    const pagerank = new Map<string, number>([
      ['alpha.ts::Alpha::function', 0.1],
      ['beta.ts::Beta::function', 0.9],
    ]);
    const labels = labelCommunities(members, pagerank);
    expect(labels.get(0)).toBe('Beta area');
  });

  it('disambiguates duplicate labels with numbered suffix', () => {
    const members = new Map<number, string[]>([
      [0, ['src/a/x.ts::X::function', 'src/a/y.ts::Y::function']],
      [1, ['src/a/z.ts::Z::function', 'src/a/w.ts::W::function']],
    ]);
    const labels = labelCommunities(members, new Map());
    const values = [...labels.values()];
    expect(new Set(values).size).toBe(2);
    expect(values).toContain('src/a');
  });

  it('normalizes backslashes in path prefix', () => {
    const members = new Map<number, string[]>([
      [0, ['src\\core\\a.ts::A::function', 'src\\core\\b.ts::B::function']],
    ]);
    const labels = labelCommunities(members, new Map());
    expect(labels.get(0)).toBe('src/core');
  });

  it('returns a cluster-N label for a one-member community with no file path', () => {
    const members = new Map<number, string[]>([[0, ['badid']]]);
    const labels = labelCommunities(members, new Map());
    expect(labels.get(0)).toMatch(/cluster/);
  });

  it('breaks pagerank ties deterministically by symbol id', () => {
    const members = new Map<number, string[]>([
      [0, ['b.ts::B::function', 'a.ts::A::function']],
    ]);
    const pagerank = new Map<string, number>([
      ['a.ts::A::function', 0.5],
      ['b.ts::B::function', 0.5],
    ]);
    const labels = labelCommunities(members, pagerank);
    expect(labels.get(0)).toBe('A area');
  });

  it('handles single-file single-symbol clusters by dropping the filename', () => {
    const members = new Map<number, string[]>([
      [0, ['src/util/helper.ts::Helper::function']],
    ]);
    const labels = labelCommunities(members, new Map());
    expect(labels.get(0)).toBe('src/util');
  });

  it('falls back to disambiguated prefix when both prefix and symbol-name candidates collide', () => {
    // Cluster 0 grabs the path prefix. Cluster 1 cannot reuse the prefix, so it falls back
    // to the top symbol name. Cluster 2 cannot reuse either, forcing the disambiguation branch.
    const members = new Map<number, string[]>([
      [0, ['src/shared/a.ts::Foo::function', 'src/shared/b.ts::Bar::function']],
      [1, ['src/shared/c.ts::Foo::function', 'src/shared/d.ts::Foo::function']],
      [2, ['src/shared/e.ts::Foo::function', 'src/shared/f.ts::Foo::function']],
    ]);
    const labels = labelCommunities(members, new Map());
    expect(labels.get(0)).toBe('src/shared');
    expect(labels.get(1)).toBe('Foo area');
    expect(labels.get(2)).toMatch(/^src\/shared \(\d+\)$/);
  });

  it('increments the disambiguation suffix when multiple duplicates collide', () => {
    const members = new Map<number, string[]>([
      [0, ['a.ts::X::function']],
      [1, ['a.ts::X::function']],
      [2, ['a.ts::X::function']],
    ]);
    const labels = labelCommunities(members, new Map());
    const values = [...labels.values()];
    expect(new Set(values).size).toBe(3);
    expect(values).toContain('X area');
    expect(values.some((label) => /\(2\)/.test(label))).toBe(true);
  });
});
