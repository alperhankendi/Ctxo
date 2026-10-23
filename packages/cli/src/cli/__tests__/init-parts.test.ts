import { describe, it, expect } from 'vitest';
import {
  INIT_PARTS,
  parseInitParts,
  pluginStepEnabled,
  resolveInitParts,
} from '../init-parts.js';

describe('init-parts', () => {
  it('lists the six parts in pipeline order', () => {
    expect([...INIT_PARTS]).toEqual(['rules', 'skills', 'guard', 'mcp', 'git-hooks', 'config']);
  });

  it('parseInitParts trims, drops empties and de-duplicates', () => {
    expect(parseInitParts(' rules, skills,,rules ')).toEqual({ parts: ['rules', 'skills'], unknown: [] });
  });

  it('parseInitParts keeps the input order', () => {
    expect(parseInitParts('config,rules,git-hooks').parts).toEqual(['config', 'rules', 'git-hooks']);
  });

  it('parseInitParts reports unknown parts', () => {
    expect(parseInitParts('rules,hooks')).toEqual({ parts: ['rules'], unknown: ['hooks'] });
  });

  it('parseInitParts reports each unknown part once and does not fold case', () => {
    expect(parseInitParts('Rules,hooks,hooks').unknown).toEqual(['Rules', 'hooks']);
  });

  it('parseInitParts of an empty or comma-only value selects nothing and reports nothing', () => {
    expect(parseInitParts('')).toEqual({ parts: [], unknown: [] });
    expect(parseInitParts(' , ,')).toEqual({ parts: [], unknown: [] });
  });

  it('resolveInitParts returns every part by default', () => {
    expect(resolveInitParts({})).toEqual(new Set(INIT_PARTS));
    expect([...resolveInitParts({})]).toEqual([...INIT_PARTS]);
  });

  it('resolveInitParts with only selects exactly those parts', () => {
    expect(resolveInitParts({ only: ['rules', 'mcp'] })).toEqual(new Set(['rules', 'mcp']));
  });

  it('resolveInitParts with an empty only selects nothing', () => {
    expect(resolveInitParts({ only: [] }).size).toBe(0);
  });

  it('resolveInitParts with skip removes those parts', () => {
    expect(resolveInitParts({ skip: ['git-hooks', 'config'] })).toEqual(
      new Set(['rules', 'skills', 'guard', 'mcp']),
    );
  });

  it('noGuard removes guard from only and from the default set', () => {
    expect(resolveInitParts({ only: ['rules', 'guard'], noGuard: true })).toEqual(new Set(['rules']));
    const all = resolveInitParts({ noGuard: true });
    expect(all.has('guard')).toBe(false);
    expect(all.size).toBe(INIT_PARTS.length - 1);
  });

  it('rulesOnly equals skip git-hooks,guard', () => {
    const viaAlias = resolveInitParts({ rulesOnly: true });
    expect(viaAlias).toEqual(resolveInitParts({ skip: ['git-hooks', 'guard'] }));
    expect(viaAlias).toEqual(new Set(['rules', 'skills', 'mcp', 'config']));
  });

  it('resolveInitParts gives only precedence over skip and rulesOnly', () => {
    // The router rejects these combinations (D10); resolveInitParts itself lets only win.
    expect(resolveInitParts({ only: ['guard', 'git-hooks'], skip: ['guard'] })).toEqual(new Set(['guard', 'git-hooks']));
    expect(resolveInitParts({ only: ['guard', 'git-hooks'], rulesOnly: true })).toEqual(new Set(['guard', 'git-hooks']));
  });

  it('resolveInitParts with only guard and noGuard selects nothing', () => {
    expect(resolveInitParts({ only: ['guard'], noGuard: true })).toEqual(new Set());
  });

  it('skip, rulesOnly and noGuard combine by union', () => {
    expect(resolveInitParts({ skip: ['skills'], rulesOnly: true, noGuard: true })).toEqual(
      new Set(['rules', 'mcp', 'config']),
    );
  });

  it('pluginStepEnabled is false with only, rulesOnly or noInstall', () => {
    expect(pluginStepEnabled({})).toBe(true);
    expect(pluginStepEnabled({ only: ['rules'] })).toBe(false);
    expect(pluginStepEnabled({ only: [] })).toBe(false);
    expect(pluginStepEnabled({ rulesOnly: true })).toBe(false);
    expect(pluginStepEnabled({ noInstall: true })).toBe(false);
  });
});
