import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../logger.js';

describe('createLogger', () => {
  const originalDebug = process.env['DEBUG'];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (originalDebug === undefined) {
      delete process.env['DEBUG'];
    } else {
      process.env['DEBUG'] = originalDebug;
    }
  });

  it('info always outputs', () => {
    delete process.env['DEBUG'];
    const log = createLogger('ctxo:test');
    log.info('hello');
    expect(stderrSpy).toHaveBeenCalledWith('[ctxo:test] hello');
  });

  it('warn always outputs', () => {
    delete process.env['DEBUG'];
    const log = createLogger('ctxo:test');
    log.warn('warning');
    expect(stderrSpy).toHaveBeenCalledWith('[ctxo:test] WARN warning');
  });

  it('error always outputs', () => {
    delete process.env['DEBUG'];
    const log = createLogger('ctxo:test');
    log.error('fail');
    expect(stderrSpy).toHaveBeenCalledWith('[ctxo:test] ERROR fail');
  });

  it('debug suppressed when DEBUG not set', () => {
    delete process.env['DEBUG'];
    const log = createLogger('ctxo:test');
    log.debug('hidden');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('debug enabled with exact namespace match', () => {
    process.env['DEBUG'] = 'ctxo:test';
    const log = createLogger('ctxo:test');
    log.debug('visible');
    expect(stderrSpy).toHaveBeenCalledWith('[ctxo:test] DEBUG visible');
  });

  it('debug enabled with wildcard ctxo:*', () => {
    process.env['DEBUG'] = 'ctxo:*';
    const log = createLogger('ctxo:git');
    log.debug('git debug');
    expect(stderrSpy).toHaveBeenCalledWith('[ctxo:git] DEBUG git debug');
  });

  it('debug enabled with global wildcard *', () => {
    process.env['DEBUG'] = '*';
    const log = createLogger('ctxo:storage');
    log.debug('storage debug');
    expect(stderrSpy).toHaveBeenCalledWith('[ctxo:storage] DEBUG storage debug');
  });

  it('debug not enabled for non-matching namespace', () => {
    process.env['DEBUG'] = 'ctxo:git';
    const log = createLogger('ctxo:storage');
    log.debug('should not appear');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('supports comma-separated DEBUG patterns', () => {
    process.env['DEBUG'] = 'ctxo:git,ctxo:storage';
    const gitLog = createLogger('ctxo:git');
    const storageLog = createLogger('ctxo:storage');
    const mcpLog = createLogger('ctxo:mcp');

    gitLog.debug('git');
    storageLog.debug('storage');
    mcpLog.debug('mcp');

    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it('passes extra args to console.error', () => {
    const log = createLogger('ctxo:test');
    log.info('count: %d', 42);
    expect(stderrSpy).toHaveBeenCalledWith('[ctxo:test] count: %d', 42);
  });
});
