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

  it('exits with error for --max-history without value', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const router = new CliRouter(process.cwd());
    await router.route(['index', '--max-history']);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('--max-history requires a positive integer'));
    expect(exitSpy).toHaveBeenCalledWith(1);

    spy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits with error for --max-history with non-numeric value', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const router = new CliRouter(process.cwd());
    await router.route(['index', '--max-history', 'abc']);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('--max-history requires a positive integer'));
    expect(exitSpy).toHaveBeenCalledWith(1);

    spy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits with error for --max-history with zero', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const router = new CliRouter(process.cwd());
    await router.route(['index', '--max-history', '0']);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('--max-history requires a positive integer'));
    expect(exitSpy).toHaveBeenCalledWith(1);

    spy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits with error for --file without path', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const router = new CliRouter(process.cwd());
    await router.route(['index', '--file']);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('--file requires a path argument'));
    expect(exitSpy).toHaveBeenCalledWith(1);

    spy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits with error for --file followed by another flag', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const router = new CliRouter(process.cwd());
    await router.route(['index', '--file', '--check']);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('--file requires a path argument'));
    expect(exitSpy).toHaveBeenCalledWith(1);

    spy.mockRestore();
    exitSpy.mockRestore();
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
