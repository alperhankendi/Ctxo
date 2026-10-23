import { describe, it, expect } from 'vitest';
import { resolveHttpPort } from '../http-port.js';

describe('resolveHttpPort', () => {
  it('starts the HTTP server on CTXO_HTTP_PORT when ctxo runs without arguments', () => {
    expect(resolveHttpPort([], { CTXO_HTTP_PORT: '7337' })).toBe('7337');
  });

  it('stays on stdio without arguments and without CTXO_HTTP_PORT', () => {
    expect(resolveHttpPort([], {})).toBeNull();
    expect(resolveHttpPort([], { CTXO_HTTP_PORT: '' })).toBeNull();
  });

  // The git post-commit hook runs `ctxo index --commit HEAD`: with the variable exported it must not
  // start a server that never returns, or `git commit` would hang.
  it('runs the CLI router, whatever CTXO_HTTP_PORT says, when there are arguments', () => {
    const env = { CTXO_HTTP_PORT: '7337' };
    expect(resolveHttpPort(['index', '--commit', 'HEAD'], env)).toBeNull();
    expect(resolveHttpPort(['index', '--help'], env)).toBeNull();
    expect(resolveHttpPort(['--version'], env)).toBeNull();
    expect(resolveHttpPort(['status'], env)).toBeNull();
  });

  it('--http selects the HTTP server, on --port or the default 3001', () => {
    expect(resolveHttpPort(['--http', '--port', '4000'], {})).toBe('4000');
    expect(resolveHttpPort(['--http'], {})).toBe('3001');
    expect(resolveHttpPort(['--http', '--port'], {})).toBe('3001');
  });

  it('--http keeps honouring CTXO_HTTP_PORT first, as before', () => {
    expect(resolveHttpPort(['--http'], { CTXO_HTTP_PORT: '7337' })).toBe('7337');
    expect(resolveHttpPort(['--http', '--port', '4000'], { CTXO_HTTP_PORT: '7337' })).toBe('7337');
  });
});
