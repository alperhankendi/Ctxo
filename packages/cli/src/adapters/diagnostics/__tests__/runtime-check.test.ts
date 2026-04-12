import { describe, it, expect } from 'vitest';
import { NodeVersionCheck, TsMorphCheck, TreeSitterCheck, checkNodeVersion } from '../checks/runtime-check.js';
import type { CheckContext } from '../../../core/diagnostics/types.js';

const ctx: CheckContext = { projectRoot: '/tmp/test', ctxoRoot: '/tmp/test/.ctxo' };

describe('checkNodeVersion (pure function)', () => {
  it('returns pass for v22.1.0', () => {
    const r = checkNodeVersion('v22.1.0');
    expect(r.status).toBe('pass');
    expect(r.message).toContain('≥20');
    expect(r.value).toBe('v22.1.0');
  });

  it('returns pass for v20.0.0', () => {
    const r = checkNodeVersion('v20.0.0');
    expect(r.status).toBe('pass');
  });

  it('returns warn for v18.19.0', () => {
    const r = checkNodeVersion('v18.19.0');
    expect(r.status).toBe('warn');
    expect(r.message).toContain('v20+ recommended');
    expect(r.fix).toContain('Upgrade');
  });

  it('returns warn for v19.0.0', () => {
    const r = checkNodeVersion('v19.0.0');
    expect(r.status).toBe('warn');
  });

  it('returns fail for v16.20.0', () => {
    const r = checkNodeVersion('v16.20.0');
    expect(r.status).toBe('fail');
    expect(r.message).toContain('v20+ required');
    expect(r.fix).toContain('Upgrade');
  });

  it('returns fail for v12.0.0', () => {
    const r = checkNodeVersion('v12.0.0');
    expect(r.status).toBe('fail');
  });

  it('always includes id and title', () => {
    for (const v of ['v24.0.0', '18.0.0', 'v14.0.0']) {
      const r = checkNodeVersion(v);
      expect(r.id).toBe('node_version');
      expect(r.title).toBe('Node.js version');
    }
  });
});

describe('NodeVersionCheck', () => {
  const check = new NodeVersionCheck();

  it('has correct id and title', () => {
    expect(check.id).toBe('node_version');
    expect(check.title).toBe('Node.js version');
  });

  it('returns pass for current Node.js (>=20)', async () => {
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('≥20');
  });

  it('includes version in value field', async () => {
    const result = await check.run(ctx);
    expect(result.value).toBe(process.version);
  });
});

describe('TsMorphCheck', () => {
  const check = new TsMorphCheck();

  it('has correct id and title', () => {
    expect(check.id).toBe('ts_morph');
    expect(check.title).toBe('TypeScript plugin (@ctxo/lang-typescript)');
  });

  it('returns pass when @ctxo/lang-typescript is installed', async () => {
    const result = await check.run(ctx);
    expect(['pass', 'warn']).toContain(result.status);
    if (result.status === 'pass') {
      expect(result.message).toBe('available');
    }
  });
});

describe('TreeSitterCheck', () => {
  const check = new TreeSitterCheck();

  it('has correct id and title', () => {
    expect(check.id).toBe('tree_sitter');
    expect(check.title).toBe('Go / C# plugins (@ctxo/lang-go, @ctxo/lang-csharp)');
  });

  it('returns pass or warn (never fail)', async () => {
    const result = await check.run(ctx);
    expect(['pass', 'warn']).toContain(result.status);
  });

  it('includes fix hint when warn', async () => {
    const result = await check.run(ctx);
    if (result.status === 'warn') {
      expect(result.fix).toContain('npm install');
    }
  });
});
