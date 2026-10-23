/**
 * The parts `ctxo init` can install, and how the `--only`, `--skip`, `--no-guard` and `--rules` flags
 * select them. Pure: no file system, no process state (the router prints errors, InitCommand acts).
 *
 * Part boundaries (D9): `config` covers `.ctxo/config.yaml`, the `.gitignore` entry and `.ctxo/index/`.
 * The language-plugin install is not a part: `--only` skips it, `--skip` keeps it (subject to
 * `--no-install`), and `--rules` keeps skipping it (see `pluginStepEnabled`).
 *
 * `domain` joins the list in PR 2B.
 */

/** The order the help lists them in. The order init runs them in is InitCommand's, not this one. */
export const INIT_PARTS = ['rules', 'skills', 'guard', 'mcp', 'git-hooks', 'config'] as const;

export type InitPart = (typeof INIT_PARTS)[number];

function isInitPart(value: string): value is InitPart {
  return (INIT_PARTS as readonly string[]).includes(value);
}

/**
 * Split a comma-separated `--only` / `--skip` value. Names are trimmed, empty items dropped and repeats
 * removed, keeping the input order. Names that are not parts come back in `unknown` (case is not folded).
 */
export function parseInitParts(raw: string): { readonly parts: InitPart[]; readonly unknown: string[] } {
  const parts: InitPart[] = [];
  const unknown: string[] = [];
  for (const item of raw.split(',')) {
    const name = item.trim();
    if (name === '') continue;
    if (isInitPart(name)) {
      if (!parts.includes(name)) parts.push(name);
    } else if (!unknown.includes(name)) {
      unknown.push(name);
    }
  }
  return { parts, unknown };
}

export interface InitPartFlags {
  /** `--only`: install exactly these parts. The router rejects it together with `skip` or `rulesOnly`. */
  readonly only?: readonly InitPart[];
  /** `--skip`: install everything except these parts. */
  readonly skip?: readonly InitPart[];
  /** `--no-guard`: does not install the safe-edit guard, whatever else is selected. */
  readonly noGuard?: boolean;
  /** `--rules`, deprecated: the same as `--skip git-hooks,guard`. */
  readonly rulesOnly?: boolean;
}

/** What `--rules` leaves out. */
const RULES_ONLY_SKIPS: readonly InitPart[] = ['git-hooks', 'guard'];

/**
 * The parts one init run installs, in `INIT_PARTS` order. `only` selects exactly those parts; otherwise
 * every part except `skip` and, for `rulesOnly`, `git-hooks` and `guard`. `noGuard` always removes `guard`.
 * An empty `only` selects nothing.
 */
export function resolveInitParts(flags: InitPartFlags): Set<InitPart> {
  const removed = new Set<InitPart>(flags.skip ?? []);
  if (flags.rulesOnly) for (const part of RULES_ONLY_SKIPS) removed.add(part);
  return new Set(
    INIT_PARTS.filter((part) => {
      if (flags.noGuard && part === 'guard') return false;
      return flags.only !== undefined ? flags.only.includes(part) : !removed.has(part);
    }),
  );
}

/**
 * Whether init offers to install language plugins. The plugin step is not a part: `--only` skips it,
 * `--skip` keeps it (subject to `--no-install`), and `--rules` has always skipped it.
 */
export function pluginStepEnabled(flags: {
  readonly only?: readonly InitPart[];
  readonly rulesOnly?: boolean;
  readonly noInstall?: boolean;
}): boolean {
  return flags.only === undefined && !flags.rulesOnly && !flags.noInstall;
}
