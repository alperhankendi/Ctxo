import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CORE_COMMANDS,
  FAST_ROUTE_COMMANDS,
  MODULE_COMMAND_PACKAGES,
  collectModuleCommands,
  loadModulesFor,
  moduleHelpLines,
  runFastRoute,
  runModuleCommand,
} from '../module-commands.js';
import type { LoadedModule } from '../../adapters/modules/module-loader.js';
import type { ModuleCommand, ModuleCommandContext } from '../../ports/i-ctxo-module.js';
import { writeStubDomainPackage } from './helpers/stub-domain-package.js';

function stubModule(commands: readonly ModuleCommand[]): LoadedModule {
  return {
    name: '@ctxo/domain',
    version: '0.0.0',
    registration: {
      id: 'domain',
      registerCommands: (registrar) => {
        for (const command of commands) registrar.registerCommand(command);
      },
    },
  };
}

function command(name: string, overrides: Partial<ModuleCommand> = {}): ModuleCommand {
  return { name, help: [`ctxo ${name}`], run: async () => 0, ...overrides };
}

const tempDirs: string[] = [];
let errorSpy: MockInstance<typeof console.error>;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-module-commands-'));
  tempDirs.push(dir);
  return dir;
}

function stderr(): string {
  return errorSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
}

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  delete (globalThis as Record<string, unknown>).__ctxoFastRoute;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best effort */
    }
  }
});

describe('module command names', () => {
  it('maps the five domain commands to @ctxo/domain and routes only the two hooks fast', () => {
    expect(MODULE_COMMAND_PACKAGES).toEqual({
      'verify-domain': '@ctxo/domain',
      'contexts-touched': '@ctxo/domain',
      domain: '@ctxo/domain',
      'domain-guard-hook': '@ctxo/domain',
      'domain-cursor-hook': '@ctxo/domain',
    });
    expect([...FAST_ROUTE_COMMANDS]).toEqual(['domain-guard-hook', 'domain-cursor-hook']);
  });

  it('no module command name is a core command name', () => {
    for (const name of Object.keys(MODULE_COMMAND_PACKAGES)) expect(CORE_COMMANDS.has(name), name).toBe(false);
  });
});

describe('runModuleCommand', () => {
  it('runModuleCommand runs a registered command with the remaining args and returns its exit code', async () => {
    const seen: Array<{ args: readonly string[]; ctx: ModuleCommandContext }> = [];
    const verify = command('verify-domain', {
      run: async (args, ctx) => {
        seen.push({ args, ctx });
        return 2;
      },
    });
    const root = tempDir();

    const code = await runModuleCommand('verify-domain', ['--json', 'extra'], { projectRoot: root, modules: [stubModule([verify])] });

    expect(code).toBe(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.args).toEqual(['--json', 'extra']);
    expect(seen[0]!.ctx.projectRoot).toBe(root);
    expect(seen[0]!.ctx.ctxoRoot).toBe(join(root, '.ctxo'));
    expect(typeof seen[0]!.ctx.readStdin).toBe('function');
  });

  it('runModuleCommand returns undefined for an unknown command', async () => {
    const modules = [stubModule([command('verify-domain')])];
    expect(await runModuleCommand('verify-nothing', [], { projectRoot: tempDir(), modules })).toBeUndefined();
    expect(await runModuleCommand('verify-domain', [], { projectRoot: tempDir(), modules: [] })).toBeUndefined();
  });

  it('a module command answers --help and -h with its own usage and is not run', async () => {
    const run = vi.fn(async () => 5);
    const verify = command('verify-domain', { help: ['ctxo verify-domain [--json]   Check the domain registry'], run });

    for (const flag of ['--help', '-h']) {
      const code = await runModuleCommand('verify-domain', ['--json', flag], { projectRoot: tempDir(), modules: [stubModule([verify])] });
      expect(code).toBe(0);
    }

    expect(run).not.toHaveBeenCalled();
    expect(stderr()).toContain('ctxo verify-domain [--json]   Check the domain registry');
  });

  it('a module command named like a core command is dropped with a warning', async () => {
    const index = command('index', { run: async () => 9 });
    const modules = [stubModule([index, command('verify-domain')])];

    const commands = collectModuleCommands(modules, new Set(['index']));

    expect([...commands.keys()]).toEqual(['verify-domain']);
    expect(stderr()).toMatch(/@ctxo\/domain[^\n]*"index"[^\n]*core command/);
    // The router's own set holds every core command, so runModuleCommand never runs the shadowing one.
    expect(await runModuleCommand('index', [], { projectRoot: tempDir(), modules })).toBeUndefined();
  });

  it('a second command with the same name is dropped with a warning, the first one stays', () => {
    const first = command('verify-domain', { help: ['first'] });
    const second = command('verify-domain', { help: ['second'] });

    const commands = collectModuleCommands([stubModule([first, second])], CORE_COMMANDS);

    expect(commands.get('verify-domain')).toBe(first);
    expect(stderr()).toContain('"verify-domain"');
  });

  it('a module whose registerCommands throws contributes no command, and nothing else fails', () => {
    const broken: LoadedModule = {
      name: '@ctxo/domain',
      version: '0.0.0',
      registration: {
        id: 'domain',
        registerCommands: () => {
          throw new Error('registry exploded');
        },
      },
    };

    expect(collectModuleCommands([broken], CORE_COMMANDS).size).toBe(0);
    expect(stderr()).toContain('registry exploded');
  });
});

describe('moduleHelpLines', () => {
  it('moduleHelpLines lists visible commands, hides hidden ones and prints the install hint without modules', () => {
    const modules = [
      stubModule([
        command('verify-domain', { help: ['ctxo verify-domain        Check the domain registry'] }),
        command('domain-guard-hook', { help: ['ctxo domain-guard-hook    Hook entry'], hidden: true }),
        command('contexts-touched', { help: ['ctxo contexts-touched     Contexts a change touches', 'ctxo contexts-touched --check   Exit 1 when unresolved'] }),
      ]),
    ];

    expect(moduleHelpLines(modules)).toEqual([
      'Domain commands (@ctxo/domain):',
      '  ctxo contexts-touched     Contexts a change touches',
      '  ctxo contexts-touched --check   Exit 1 when unresolved',
      '  ctxo verify-domain        Check the domain registry',
    ]);
    expect(moduleHelpLines([])).toEqual(['  Domain commands need @ctxo/domain: run "ctxo install domain"']);
  });
});

const FAST_ROUTE_STUB = (result: string): string => `
export async function register(host) {
  return {
    id: 'domain',
    registerCommands(registrar) {
      registrar.registerCommand({
        name: 'domain-guard-hook',
        help: ['ctxo domain-guard-hook'],
        hidden: true,
        async run(args, ctx) {
          globalThis.__ctxoFastRoute = { mode: host.mode, args, projectRoot: ctx.projectRoot, ctxoRoot: ctx.ctxoRoot };
          ${result}
        },
      });
    },
  };
}
`;

describe('loadModulesFor', () => {
  it('loadModulesFor builds no module host when @ctxo/domain is not installed', async () => {
    const hostModule = await import('../module-host.js');
    const createHost = vi.spyOn(hostModule, 'createModuleHost');

    const modules = await loadModulesFor(tempDir(), 'cli', { cliAnchor: tempDir() });

    expect(modules).toEqual([]);
    expect(createHost).not.toHaveBeenCalled();
  });

  it('loadModulesFor builds the host and loads the module when a copy is installed', async () => {
    const root = tempDir();
    writeStubDomainPackage(root, "export async function register() { return { id: 'domain' }; }\n");
    const hostModule = await import('../module-host.js');
    const createHost = vi.spyOn(hostModule, 'createModuleHost');

    const modules = await loadModulesFor(root, 'cli', { cliAnchor: tempDir() });

    expect(modules.map((m) => m.name)).toEqual(['@ctxo/domain']);
    expect(createHost).toHaveBeenCalledTimes(1);
  });
});

describe('runFastRoute', () => {
  it('runFastRoute exits 0 when @ctxo/domain is not installed', async () => {
    const code = await runFastRoute(['domain-guard-hook'], tempDir(), { cliAnchor: tempDir() });
    expect(code).toBe(0);
  });

  it('runFastRoute finds the copy next to the CLI anchor', async () => {
    const anchor = tempDir();
    writeStubDomainPackage(anchor, FAST_ROUTE_STUB('return 6;'));

    const code = await runFastRoute(['domain-guard-hook'], tempDir(), { cliAnchor: anchor });

    expect(code).toBe(6);
  });

  it("runFastRoute runs the module's command and returns its exit code", async () => {
    const root = tempDir();
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    writeStubDomainPackage(root, FAST_ROUTE_STUB('return 3;'));

    // Started in a subdirectory: the project root is the nearest directory that holds .git.
    const code = await runFastRoute(['domain-guard-hook', '--x'], join(root, 'src', 'deep'));

    expect(code).toBe(3);
    expect((globalThis as Record<string, unknown>).__ctxoFastRoute).toEqual({
      mode: 'hook',
      args: ['--x'],
      projectRoot: root,
      ctxoRoot: join(root, '.ctxo'),
    });
  });

  describe('domain-cursor-hook', () => {
    let out: string[];
    beforeEach(() => {
      out = [];
      vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);
    });

    const brokenImport = async (): Promise<never> => {
      throw new Error('Cannot find module cursor-hook-route');
    };

    it.each([
      ['a prompt', JSON.stringify({ hook_event_name: 'beforeSubmitPrompt', conversation_id: 'c', prompt: 'go' })],
      ['a prompt told by its shape', JSON.stringify({ conversation_id: 'c', prompt: 'go' })],
      ['non-JSON stdin', '{oops'],
      ['empty stdin', ''],
    ])('prints exactly {"continue":true} for %s when the route cannot be imported', async (_name, stdin) => {
      const code = await runFastRoute(['domain-cursor-hook'], tempDir(), { importCursorRoute: brokenImport, readStdin: async () => stdin });
      expect(code).toBe(0);
      expect(out).toEqual(['{"continue":true}\n']);
      expect(stderr()).toContain('could not load its route');
    });

    it('prints nothing for a stop or another named event when the route cannot be imported', async () => {
      for (const stdin of [
        JSON.stringify({ hook_event_name: 'stop', status: 'completed' }),
        JSON.stringify({ status: 'completed' }),
        JSON.stringify({ hook_event_name: 'afterFileEdit' }),
      ]) {
        expect(await runFastRoute(['domain-cursor-hook'], tempDir(), { importCursorRoute: brokenImport, readStdin: async () => stdin })).toBe(0);
      }
      expect(out).toEqual([]);
    });

    it('prints {"continue":true} when reading stdin fails as well', async () => {
      const readStdin = async (): Promise<string> => {
        throw new Error('EPIPE');
      };
      expect(await runFastRoute(['domain-cursor-hook'], tempDir(), { importCursorRoute: brokenImport, readStdin })).toBe(0);
      expect(out).toEqual(['{"continue":true}\n']);
    });

    it('--help skips the hook route and prints the command usage, reading no stdin', async () => {
      const root = tempDir();
      mkdirSync(join(root, '.git'));
      writeStubDomainPackage(root, FAST_ROUTE_STUB('return 0;').replace("name: 'domain-guard-hook'", "name: 'domain-cursor-hook'").replace("help: ['ctxo domain-guard-hook']", "help: ['Usage: ctxo domain-cursor-hook']"));
      let routeImported = false;
      let stdinRead = false;
      const code = await runFastRoute(['domain-cursor-hook', '--help'], root, {
        importCursorRoute: async () => {
          routeImported = true;
          throw new Error('not expected');
        },
        readStdin: async () => {
          stdinRead = true;
          return '';
        },
      });
      expect(code).toBe(0);
      expect(routeImported).toBe(false);
      expect(stdinRead).toBe(false);
      expect(out).toEqual([]);
      expect(stderr()).toContain('Usage: ctxo domain-cursor-hook');
    });
  });

  it('runFastRoute exits 0 when the command throws', async () => {
    const root = tempDir();
    writeStubDomainPackage(root, FAST_ROUTE_STUB("throw new Error('hook exploded');"));

    const code = await runFastRoute(['domain-guard-hook'], root);

    expect(code).toBe(0);
    expect((globalThis as Record<string, unknown>).__ctxoFastRoute).toBeDefined();
    expect(stderr()).toContain('hook exploded');
  });
});
