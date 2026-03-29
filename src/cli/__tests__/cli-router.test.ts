import { describe, it, expect, vi } from 'vitest';
import { CliRouter } from '../cli-router.js';

describe('CliRouter', () => {
  it('outputs help text for --help flag', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = new CliRouter(process.cwd());

    await router.route(['--help']);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('ctxo index'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('ctxo sync'));
    spy.mockRestore();
  });

  it('outputs help text for -h flag', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = new CliRouter(process.cwd());

    await router.route(['-h']);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('ctxo'));
    spy.mockRestore();
  });

  it('outputs help when no command provided', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = new CliRouter(process.cwd());

    await router.route([]);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('ctxo'));
    spy.mockRestore();
  });

  it('exits with error for unknown subcommand', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const router = new CliRouter(process.cwd());
    await router.route(['unknown-cmd']);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Unknown command'));
    expect(exitSpy).toHaveBeenCalledWith(1);

    spy.mockRestore();
    exitSpy.mockRestore();
  });
});
