import { join } from 'node:path';
import type { LoadedModule } from '../adapters/modules/module-loader.js';
import type { CtxoHost, ModuleCommand, ModuleCommandContext } from '../ports/i-ctxo-module.js';
import { compareCodepoint } from '../core/compare-codepoint.js';
import { createLogger } from '../core/logger.js';
import { locateGitRoot } from './cli-paths.js';

/**
 * Commands that opt-in modules contribute (ADR-018), and the fast route for hook commands.
 *
 * This file is loaded on every run (the entry imports `FAST_ROUTE_COMMANDS`), so its static imports stay
 * light: the module host and the module loader are imported on demand, and neither the CLI router nor the
 * MCP stack is ever imported here.
 */

const log = createLogger('ctxo:modules');

/**
 * The module commands the CLI knows by name, and the package that provides each. Without the package a
 * known name prints an install hint and exits 1 (the hook command exits 0 silently), so CI never passes
 * on a command that did not run.
 */
export const MODULE_COMMAND_PACKAGES: Readonly<Record<string, string>> = Object.freeze({
  'verify-domain': '@ctxo/domain',
  'contexts-touched': '@ctxo/domain',
  domain: '@ctxo/domain',
  'domain-guard-hook': '@ctxo/domain',
  'domain-cursor-hook': '@ctxo/domain',
});

/** Commands the entry runs without the CLI router or the MCP stack (hook commands with a time budget). */
export const FAST_ROUTE_COMMANDS: ReadonlySet<string> = new Set(['domain-guard-hook', 'domain-cursor-hook']);

/** The commands the CLI router handles itself. A module command with one of these names is dropped. */
export const CORE_COMMANDS: ReadonlySet<string> = new Set([
  'index',
  'sync',
  'status',
  'verify-index',
  'init',
  'watch',
  'stats',
  'doctor',
  'visualize',
  'version',
  'install',
  'update',
  'blast-radius',
  'contexts',
  'gate',
  'gate-hook',
]);

/** True when `command` is one of the module command names the CLI knows (own keys only). */
export function isKnownModuleCommand(command: string): boolean {
  return Object.hasOwn(MODULE_COMMAND_PACKAGES, command);
}

/**
 * The commands the loaded modules register, by name. A command named like a core command, or like a
 * command an earlier module registered, is dropped with a warning. A module whose `registerCommands`
 * throws contributes nothing and the others still count.
 */
export function collectModuleCommands(
  modules: readonly LoadedModule[],
  coreCommands: ReadonlySet<string>,
): Map<string, ModuleCommand> {
  const commands = new Map<string, ModuleCommand>();
  for (const module of modules) {
    const register = module.registration.registerCommands;
    if (typeof register !== 'function') continue;
    try {
      register.call(module.registration, {
        registerCommand: (command: ModuleCommand) => {
          if (coreCommands.has(command.name)) {
            log.warn(`${module.name} command "${command.name}" has the name of a core command and was ignored`);
          } else if (commands.has(command.name)) {
            log.warn(`${module.name} command "${command.name}" is already registered and was ignored`);
          } else {
            commands.set(command.name, command);
          }
        },
      });
    } catch (err) {
      log.warn(`${module.name} could not register its commands: ${(err as Error).message}`);
    }
  }
  return commands;
}

/** All of stdin as UTF-8 text; empty on a terminal, where nothing is piped in. */
export async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Runs the module command `command` with `args` (the words after the command name) and resolves to its
 * exit code, or to undefined when no loaded module registers it. `--help` or `-h` prints the command's
 * full usage (`usage`, else `help`) and runs nothing. A throwing command rejects; the caller decides the exit code.
 */
export async function runModuleCommand(
  command: string,
  args: readonly string[],
  options: {
    readonly projectRoot: string;
    readonly modules: readonly LoadedModule[];
    /** Stands in for reading stdin (a route that already read it). */
    readonly readStdin?: () => Promise<string>;
  },
): Promise<number | undefined> {
  const found = collectModuleCommands(options.modules, CORE_COMMANDS).get(command);
  if (found === undefined) return undefined;
  if (args.some((arg) => arg === '--help' || arg === '-h')) {
    console.error((found.usage ?? found.help).join('\n'));
    return 0;
  }
  const ctx: ModuleCommandContext = {
    projectRoot: options.projectRoot,
    ctxoRoot: join(options.projectRoot, '.ctxo'),
    readStdin: options.readStdin ?? readAllStdin,
  };
  return found.run(args, ctx);
}

/**
 * The block `ctxo --help` ends with: the visible module commands' usage lines under a heading, sorted by
 * command name, or one install hint line when no module is loaded.
 */
export function moduleHelpLines(modules: readonly LoadedModule[]): string[] {
  if (modules.length === 0) return ['  Domain commands need @ctxo/domain: run "ctxo install domain"'];
  const visible = [...collectModuleCommands(modules, CORE_COMMANDS).values()]
    .filter((command) => command.hidden !== true)
    .sort((a, b) => compareCodepoint(a.name, b.name));
  const lines = visible.flatMap((command) => command.help.map((line) => `  ${line}`));
  return lines.length === 0 ? [] : ['Domain commands (@ctxo/domain):', ...lines];
}

/**
 * The loaded modules for `projectRoot` in `mode`, or none when loading fails. The loader is imported here,
 * on demand, and the module host (with the zod and graph code it pulls in) only when a copy of the module
 * exists, so a run without `@ctxo/domain` (the post-commit `ctxo index --commit HEAD`, `--help`, `doctor`,
 * the hook route) never loads it.
 */
export async function loadModulesFor(
  projectRoot: string,
  mode: CtxoHost['mode'],
  options: { readonly cliAnchor?: string } = {},
): Promise<readonly LoadedModule[]> {
  try {
    const [{ DOMAIN_MODULE_PACKAGE, loadCtxoModules }, { resolvePackageCandidates }] = await Promise.all([
      import('../adapters/modules/module-loader.js'),
      import('../adapters/language/plugin-discovery.js'),
    ]);
    if (resolvePackageCandidates(DOMAIN_MODULE_PACKAGE, projectRoot, options.cliAnchor).length === 0) return [];
    const { createModuleHost } = await import('./module-host.js');
    const { modules } = await loadCtxoModules(createModuleHost({ projectRoot, mode }), { cliAnchor: options.cliAnchor });
    return modules;
  } catch (err) {
    log.warn(`Modules could not be loaded: ${(err as Error).message}`);
    return [];
  }
}

export interface FastRouteOptions {
  /** A directory standing in for the CLI's location when modules are looked up (tests); defaults to the running CLI. */
  readonly cliAnchor?: string;
}

/**
 * The fast route for hook commands (`FAST_ROUTE_COMMANDS`): finds the project root, loads the modules in
 * hook mode and runs the command, without the CLI router or the MCP stack. Fails open: resolves to 0 when
 * the module or the command is missing, or on any error (reported on stderr, never on stdout).
 */
export async function runFastRoute(args: readonly string[], cwd: string, options: FastRouteOptions = {}): Promise<number> {
  const command = args[0] ?? '';
  if (command === 'domain-cursor-hook') {
    try {
      const { runCursorHookRoute } = await import('./cursor-hook-route.js');
      return await runCursorHookRoute(args, cwd, options);
    } catch (err) {
      console.error(`[ctxo] ${command} failed, allowing: ${(err as Error).message}`);
      return 0;
    }
  }
  try {
    const projectRoot = locateGitRoot(cwd) ?? cwd;
    const modules = await loadModulesFor(projectRoot, 'hook', { cliAnchor: options.cliAnchor });
    const code = await runModuleCommand(command, args.slice(1), { projectRoot, modules });
    return typeof code === 'number' && Number.isInteger(code) ? code : 0;
  } catch (err) {
    console.error(`[ctxo] ${command} failed, allowing: ${(err as Error).message}`);
    return 0;
  }
}
