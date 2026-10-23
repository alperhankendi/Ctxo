import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
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

describe('cli-router update command', () => {
  it('parses update flags and dispatches to UpdateCommand.run', async () => {
    const calls: Array<{ projectRoot: string; options: unknown }> = [];
    const router = new CliRouter(process.cwd());
    const original = await import('../update-command.js');
    // Must be constructible: cli-router calls `new UpdateCommand(...)`. An arrow
    // function has no [[Construct]] slot, so it throws under vitest 5.
    const spy = vi.spyOn(original, 'UpdateCommand' as any).mockImplementation(
      function (this: unknown, projectRoot: string) {
        return {
          run: async (options: unknown) => { calls.push({ projectRoot, options }); },
        };
      } as any,
    );

    await router.route(['update', '--check', '--json', '--pm', 'pnpm', '--print', '--global', '--force']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.options).toMatchObject({
      check: true,
      json: true,
      pm: 'pnpm',
      print: true,
      global: true,
      force: true,
    });
    spy.mockRestore();
  });
});

describe('cli-router contexts command', () => {
  it('routes contexts --json to ContextsCommand.run', async () => {
    const calls: Array<{ projectRoot: string; options: unknown }> = [];
    const original = await import('../contexts-command.js');
    // Must be constructible (see the update test above), hence a function expression.
    const spy = vi.spyOn(original, 'ContextsCommand' as any).mockImplementation(
      function (this: unknown, projectRoot: string) {
        return { run: (options: unknown) => { calls.push({ projectRoot, options }); } };
      } as any,
    );
    await new CliRouter(process.cwd()).route(['contexts', '--json']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.options).toEqual({ json: true });
    spy.mockRestore();
  });

  it('help documents ctxo contexts and ctxo contexts --json', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new CliRouter(process.cwd()).route(['--help']);
    const help = errorSpy.mock.calls.map((a) => String(a[0])).join('\n');
    errorSpy.mockRestore();
    expect(help).toContain('ctxo contexts             Candidate contexts from dependency and co-change clusters (table)');
    expect(help).toContain('ctxo contexts --json      Same, full contexts-view.json to stdout');
  });
});

describe('cli-router index co-change flags', () => {
  let indexRuns: Array<Record<string, unknown>>;
  let indexConstructed: number;
  let errorSpy: MockInstance<typeof console.error>;
  let exitSpy: MockInstance<typeof process.exit>;

  beforeEach(async () => {
    indexRuns = [];
    indexConstructed = 0;
    // Replace IndexCommand first: if a flag slips through validation, nothing may index the real repo.
    // Must be constructible (see the update test above), hence a function expression.
    const original = await import('../index-command.js');
    vi.spyOn(original, 'IndexCommand' as any).mockImplementation(
      function (this: unknown) {
        indexConstructed += 1;
        return {
          run: async (options: Record<string, unknown>) => { indexRuns.push(options); },
        };
      } as any,
    );
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function route(...args: string[]): Promise<void> {
    await new CliRouter(process.cwd()).route(['index', ...args]);
  }

  it('passes --cochange-commits and --cochange-since to IndexCommand.run', async () => {
    await route('--cochange-commits', '500', '--cochange-since', '12m');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(indexRuns).toHaveLength(1);
    expect(indexRuns[0]).toMatchObject({ cochangeCommits: 500, cochangeSince: '12m' });
  });

  it('accepts all as the value of --cochange-commits', async () => {
    await route('--cochange-commits', 'all');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(indexRuns[0]).toMatchObject({ cochangeCommits: 'all' });
  });

  it.each(['30d', '2w', '12m', '1y', '0d'])('accepts %s as the value of --cochange-since', async (since) => {
    await route('--cochange-since', since);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(indexRuns[0]).toMatchObject({ cochangeSince: since });
  });

  it('leaves both co-change options unset when the flags are absent', async () => {
    await route('--max-history', '5');

    expect(indexRuns).toHaveLength(1);
    expect(indexRuns[0]!['cochangeCommits']).toBeUndefined();
    expect(indexRuns[0]!['cochangeSince']).toBeUndefined();
    expect(indexRuns[0]).toMatchObject({ maxHistory: 5 });
  });

  it('exits with error for --cochange-commits without a value', async () => {
    await route('--cochange-commits');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--cochange-commits requires a positive integer or "all"'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(indexConstructed).toBe(0);
  });

  it.each(['abc', '0', '-5', '1.5', '2e3', '0x10', 'ALL', '', '--skip-history'])(
    'exits with error for --cochange-commits %j',
    async (value) => {
      await route('--cochange-commits', value);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--cochange-commits requires a positive integer or "all"'));
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(indexConstructed).toBe(0);
    },
  );

  it('exits with error for --cochange-since without a value', async () => {
    await route('--cochange-since');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--cochange-since requires a duration'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(indexConstructed).toBe(0);
  });

  it.each(['abc', '12', '5x', '1.5m', '-3d', '30D', 'm', '', '--skip-history'])(
    'exits with error for --cochange-since %j',
    async (value) => {
      await route('--cochange-since', value);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--cochange-since requires a duration such as 30d, 2w, 12m or 1y'));
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(indexConstructed).toBe(0);
    },
  );

  it('documents both flags and says --max-history controls intent depth only', async () => {
    await new CliRouter(process.cwd()).route(['--help']);

    const help = errorSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(help).toMatch(/--max-history N[^\n]*intent depth only/);
    expect(help).toContain('--cochange-commits <n|all>');
    expect(help).toContain('--cochange-since <duration>');
  });
});

describe('cli-router index --files, --file and --commit', () => {
  let indexRuns: Array<Record<string, unknown>>;
  let indexConstructed: number;
  let errorSpy: MockInstance<typeof console.error>;
  let exitSpy: MockInstance<typeof process.exit>;

  beforeEach(async () => {
    indexRuns = [];
    indexConstructed = 0;
    // Replace IndexCommand first: if a flag slips through validation, nothing may index the real repo.
    const original = await import('../index-command.js');
    vi.spyOn(original, 'IndexCommand' as any).mockImplementation(
      function (this: unknown) {
        indexConstructed += 1;
        return {
          run: async (options: Record<string, unknown>) => { indexRuns.push(options); },
        };
      } as any,
    );
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function route(...args: string[]): Promise<void> {
    await new CliRouter(process.cwd()).route(['index', ...args]);
  }

  it('passes every value of --files up to the next flag', async () => {
    await route('--files', 'src/a.ts', 'src/b.ts', 'docs/my notes.md', '--max-history', '5');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(indexRuns).toHaveLength(1);
    expect(indexRuns[0]).toMatchObject({ files: ['src/a.ts', 'src/b.ts', 'docs/my notes.md'], maxHistory: 5 });
    expect(indexRuns[0]!['commit']).toBeUndefined();
  });

  it('collects the values of a repeated --files', async () => {
    await route('--files', 'src/a.ts', '--skip-history', '--files', 'src/b.ts');

    expect(indexRuns[0]).toMatchObject({ files: ['src/a.ts', 'src/b.ts'], skipHistory: true });
  });

  it('passes --commit with its one revision', async () => {
    await route('--commit', 'HEAD', '--skip-community');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(indexRuns[0]).toMatchObject({ commit: 'HEAD', skipCommunity: true });
    expect(indexRuns[0]!['files']).toBeUndefined();
  });

  it('keeps --file as an alias of --files with one path', async () => {
    await route('--file', 'src/a.ts');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(indexRuns[0]).toMatchObject({ files: ['src/a.ts'] });
  });

  it('combines --file, --files and --commit', async () => {
    await route('--file', 'src/a.ts', '--files', 'src/b.ts', 'src/c.ts', '--commit', 'abc1234');

    expect(indexRuns[0]).toMatchObject({ files: ['src/a.ts', 'src/b.ts', 'src/c.ts'], commit: 'abc1234' });
  });

  it('leaves files and commit unset when the flags are absent', async () => {
    await route('--max-history', '5');

    expect(indexRuns).toHaveLength(1);
    expect(indexRuns[0]!['files']).toBeUndefined();
    expect(indexRuns[0]!['commit']).toBeUndefined();
  });

  it.each([[['--files']], [['--files', '--check']]])('exits with error for %j without a path', async (args) => {
    await route(...args);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--files requires at least one path'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(indexConstructed).toBe(0);
  });

  it.each([[['--commit']], [['--commit', '--check']]])('exits with error for %j without a revision', async (args) => {
    await route(...args);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--commit requires a revision'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(indexConstructed).toBe(0);
  });

  it('documents --files, --file and --commit in the help', async () => {
    await new CliRouter(process.cwd()).route(['--help']);

    const help = errorSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(help).toContain('--files <path...>');
    expect(help).toContain('--file <path>');
    expect(help).toContain('--commit <rev>');
    // --commit is meant for the commit that was just made, which is what the post-commit hook passes.
    expect(help).toMatch(/--commit <rev>[^\n]*commit just made[^\n]*HEAD/);
  });
});

describe('cli-router subcommand --help and -h', () => {
  // Every command class is replaced before routing: a subcommand that ignores --help must never run for real
  // (a real `init` or `index` here would write hooks and files into the repository running the tests).
  const SUBCOMMANDS = [
    'index', 'sync', 'status', 'verify-index', 'init', 'watch', 'stats', 'doctor', 'visualize',
    'version', 'install', 'update', 'blast-radius', 'contexts', 'gate', 'gate-hook',
  ];

  let constructed: string[];
  let errorSpy: MockInstance<typeof console.error>;
  let exitSpy: MockInstance<typeof process.exit>;
  let previousExitCode: typeof process.exitCode;

  beforeEach(async () => {
    constructed = [];
    previousExitCode = process.exitCode;
    // Keyed by class name; every one of them is replaced.
    const modules: Record<string, Record<string, unknown>> = {
      IndexCommand: await import('../index-command.js'),
      SyncCommand: await import('../sync-command.js'),
      StatusCommand: await import('../status-command.js'),
      VerifyCommand: await import('../verify-command.js'),
      InitCommand: await import('../init-command.js'),
      WatchCommand: await import('../watch-command.js'),
      StatsCommand: await import('../stats-command.js'),
      DoctorCommand: await import('../doctor-command.js'),
      VisualizeCommand: await import('../visualize-command.js'),
      VersionCommand: await import('../version-command.js'),
      InstallCommand: await import('../install-command.js'),
      UpdateCommand: await import('../update-command.js'),
      BlastRadiusCommand: await import('../blast-radius-command.js'),
      ContextsCommand: await import('../contexts-command.js'),
      GateHookCommand: await import('../gate-hook-command.js'),
      GateCommand: await import('../gate-command.js'),
    };
    for (const [name, mod] of Object.entries(modules)) {
      vi.spyOn(mod, name as never).mockImplementation(
        function (this: unknown) {
          constructed.push(name);
          const noop = async () => {};
          return { run: noop, preview: noop };
        } as never,
      );
    }
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = previousExitCode;
  });

  function printed(): string {
    return errorSpy.mock.calls.map((args) => String(args[0])).join('\n');
  }

  it.each(['--help', '-h'])('ctxo index %s prints the help and does not index', async (flag) => {
    await new CliRouter(process.cwd()).route(['index', flag]);

    expect(constructed).toEqual([]);
    expect(printed()).toMatch(/--max-history N[^\n]*intent depth only/);
    expect(printed()).toContain('--cochange-commits <n|all>');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(previousExitCode);
  });

  it.each(['--help', '-h'])('ctxo init %s prints the help and does not run init', async (flag) => {
    await new CliRouter(process.cwd()).route(['init', flag]);

    expect(constructed).toEqual([]);
    expect(printed()).toContain('ctxo init');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(previousExitCode);
  });

  it.each(SUBCOMMANDS)('ctxo %s --help prints the help, runs nothing and exits 0', async (command) => {
    await new CliRouter(process.cwd()).route([command, '--help']);

    expect(constructed).toEqual([]);
    expect(printed()).toContain('Usage:');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(previousExitCode);
  });

  it.each(SUBCOMMANDS)('ctxo %s -h prints the help, runs nothing and exits 0', async (command) => {
    await new CliRouter(process.cwd()).route([command, '-h']);

    expect(constructed).toEqual([]);
    expect(printed()).toContain('Usage:');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(previousExitCode);
  });

  it('prints the help when --help follows other flags, and does not parse them', async () => {
    // --max-history 0 is invalid, but help wins: no error, no exit
    await new CliRouter(process.cwd()).route(['index', '--max-history', '0', '--help']);

    expect(constructed).toEqual([]);
    expect(printed()).toContain('Usage:');
    expect(printed()).not.toContain('requires a positive integer');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('ctxo blast-radius --help does not treat the flag as a symbol id', async () => {
    await new CliRouter(process.cwd()).route(['blast-radius', '--help']);

    expect(constructed).toEqual([]);
    expect(printed()).not.toContain('usage: ctxo blast-radius <symbolId>');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('keeps running the subcommand when no help flag is given', async () => {
    await new CliRouter(process.cwd()).route(['sync']);

    expect(constructed).toEqual(['SyncCommand']);
  });
});

describe('cli-router init parts flags', () => {
  let initRuns: Array<Record<string, unknown>>;
  let initConstructed: number;
  let errorSpy: MockInstance<typeof console.error>;
  let exitSpy: MockInstance<typeof process.exit>;

  beforeEach(async () => {
    initRuns = [];
    initConstructed = 0;
    // Replace InitCommand first: a flag that slips through validation must never run a real init in this repo.
    // Must be constructible (see the update test above), hence a function expression.
    const original = await import('../init-command.js');
    vi.spyOn(original, 'InitCommand' as any).mockImplementation(
      function (this: unknown) {
        initConstructed += 1;
        return {
          run: async (options: Record<string, unknown>) => { initRuns.push(options); },
        };
      } as any,
    );
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function route(...args: string[]): Promise<void> {
    await new CliRouter(process.cwd()).route(['init', ...args]);
  }

  function printed(): string {
    return errorSpy.mock.calls.map((args) => String(args[0])).join('\n');
  }

  it('passes --only, --skip and --no-guard to InitCommand.run', async () => {
    await route('--tools', 'claude-code', '--only', 'rules,skills,guard', '-y');
    await route('--skip', 'git-hooks', '--no-guard');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(initRuns).toHaveLength(2);
    expect(initRuns[0]).toMatchObject({ tools: ['claude-code'], yes: true, only: ['rules', 'skills', 'guard'] });
    expect(initRuns[0]!['skip']).toBeUndefined();
    expect(initRuns[0]!['noGuard']).toBe(false);
    expect(initRuns[1]).toMatchObject({ skip: ['git-hooks'], noGuard: true });
    expect(initRuns[1]!['only']).toBeUndefined();
  });

  it('leaves the part options unset when the flags are absent', async () => {
    await route('--tools', 'cursor', '--dry-run', '--no-install');

    expect(initRuns).toHaveLength(1);
    expect(initRuns[0]).toMatchObject({ tools: ['cursor'], dryRun: true, noInstall: true, rulesOnly: false, noGuard: false });
    expect(initRuns[0]!['only']).toBeUndefined();
    expect(initRuns[0]!['skip']).toBeUndefined();
  });

  it('keeps --rules as the rulesOnly option', async () => {
    await route('--rules', '--skip', 'config');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(initRuns[0]).toMatchObject({ rulesOnly: true, skip: ['config'] });
  });

  it('accepts the --only=<parts> and --skip=<parts> spellings and repeated flags', async () => {
    await route('--only=rules, skills');
    await route('--skip', 'mcp', '--skip=config,mcp');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(initRuns[0]).toMatchObject({ only: ['rules', 'skills'] });
    expect(initRuns[1]).toMatchObject({ skip: ['mcp', 'config'] });
  });

  it('passes an empty selection through for InitCommand to report', async () => {
    await route('--only', ',');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(initRuns[0]).toMatchObject({ only: [] });
  });

  it('rejects an unknown init part before constructing InitCommand', async () => {
    await route('--only', 'rules,hooks');

    expect(errorSpy).toHaveBeenCalledWith(
      '[ctxo] Unknown init part: hooks. Valid parts: rules, skills, guard, mcp, git-hooks, config',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(initConstructed).toBe(0);
  });

  it('rejects an unknown part given to --skip', async () => {
    await route('--skip', 'domain');

    expect(errorSpy).toHaveBeenCalledWith(
      '[ctxo] Unknown init part: domain. Valid parts: rules, skills, guard, mcp, git-hooks, config',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(initConstructed).toBe(0);
  });

  it.each([
    [['--only', 'rules', '--skip', 'skills']],
    [['--only', 'rules', '--rules']],
    [['--rules', '--only', 'rules']],
    [['--skip', 'skills', '--only', 'rules']],
  ])('rejects --only combined with --skip or --rules: %j', async (args) => {
    await route(...args);

    expect(errorSpy).toHaveBeenCalledWith('[ctxo] --only cannot be combined with --skip or --rules');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(initConstructed).toBe(0);
  });

  it('allows --only together with --no-guard', async () => {
    await route('--only', 'rules,guard', '--no-guard');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(initRuns[0]).toMatchObject({ only: ['rules', 'guard'], noGuard: true });
  });

  it.each(['--only', '--skip'])('rejects %s without a value', async (flag) => {
    const message = `[ctxo] ${flag} requires a comma-separated list of parts: rules, skills, guard, mcp, git-hooks, config`;

    await route(flag);
    expect(errorSpy).toHaveBeenLastCalledWith(message);

    await route(flag, '--dry-run');
    expect(errorSpy).toHaveBeenLastCalledWith(message);

    await route(flag, '');
    expect(errorSpy).toHaveBeenLastCalledWith(message);

    expect(exitSpy).toHaveBeenCalledTimes(3);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(initConstructed).toBe(0);
  });

  it.each(['--only', '--skip'])('%s followed by a flag token such as -y has no value', async (flag) => {
    const message = `[ctxo] ${flag} requires a comma-separated list of parts: rules, skills, guard, mcp, git-hooks, config`;

    await route(flag, '-y');
    expect(errorSpy).toHaveBeenLastCalledWith(message);
    expect(printed()).not.toContain('Unknown init part');

    await route('--tools', 'claude-code', flag, '-y', 'rules');
    expect(errorSpy).toHaveBeenLastCalledWith(message);

    expect(exitSpy).toHaveBeenCalledTimes(2);
    expect(initConstructed).toBe(0);
  });

  it('handles the = spelling edges: an empty value, a comma-only value and an attached dash', async () => {
    const missing = (flag: string): string =>
      `[ctxo] ${flag} requires a comma-separated list of parts: rules, skills, guard, mcp, git-hooks, config`;

    await route('--only=');
    expect(errorSpy).toHaveBeenLastCalledWith(missing('--only'));
    await route('--skip=');
    expect(errorSpy).toHaveBeenLastCalledWith(missing('--skip'));
    await route('--only=-y');
    expect(errorSpy).toHaveBeenLastCalledWith('[ctxo] Unknown init part: -y. Valid parts: rules, skills, guard, mcp, git-hooks, config');
    expect(exitSpy).toHaveBeenCalledTimes(3);
    expect(initConstructed).toBe(0);

    await route('--only=,');
    await route('--only=rules', '--only', 'skills,rules');
    expect(exitSpy).toHaveBeenCalledTimes(3);
    expect(initRuns).toEqual([expect.objectContaining({ only: [] }), expect.objectContaining({ only: ['rules', 'skills'] })]);
  });

  it('help lists --only, --skip and --no-guard and marks --rules deprecated', async () => {
    await route('--help');

    const help = printed();
    expect(help).toContain('ctxo init --only <parts>  Install only these parts: rules,skills,guard,mcp,git-hooks,config');
    expect(help).toContain('ctxo init --skip <parts>  Install everything except these parts');
    expect(help).toContain('ctxo init --no-guard      Does not install the Claude Code safe-edit guard');
    expect(help).not.toContain('rules use the full block');
    expect(help).toContain('ctxo init --rules         Deprecated: same as --skip git-hooks,guard');
    expect(help).toContain('ctxo init --dry-run       List every file init would create or change');
    expect(initConstructed).toBe(0);
  });

  it('help names the agent-setup remediation on the doctor --fix line', async () => {
    await route('--help');

    expect(printed()).toContain(
      'ctxo doctor --fix         Apply fixes in dependency order: config, git hooks, skills, the safe-edit guard, rules blocks, plugins, index (--dry-run, --yes)',
    );
    expect(printed()).toContain('ctxo init --tools a,b -y  Non-interactive (claude-code,cursor,...); -y without --tools selects every tool');
  });

  it('help keeps the post-commit hook wording on the ctxo init line', async () => {
    await route('--help');

    expect(printed()).toMatch(/ctxo init {17}Interactive setup \(rules, skills, guard, MCP, git hooks, config\)[^\n]*post-commit hook runs ctxo index --commit HEAD/);
  });
});
