import { describe, it, expect } from 'vitest';
import { DATA_EDGE_KINDS, isDataResourceKind } from '../data-kinds.js';

describe('data-kinds', () => {
  it('isDataResourceKind accepts table and view only', () => {
    expect(isDataResourceKind('table')).toBe(true);
    expect(isDataResourceKind('view')).toBe(true);
    expect(isDataResourceKind('procedure')).toBe(false);
    expect(isDataResourceKind('class')).toBe(false);
  });

  it('DATA_EDGE_KINDS holds reads, writes and executes', () => {
    expect([...DATA_EDGE_KINDS].sort()).toEqual(['executes', 'reads', 'writes']);
  });
});
