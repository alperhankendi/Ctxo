# PR 2A: Tiered Agent Rules, Granular Init and Agent-Setup Doctor Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a compact always-loaded ctxo block for Claude Code where the safe-edit guard and the skills back it up, keep the full block for every other client, make the rules writer stop clobbering and duplicating, make `ctxo init` granular, and add doctor checks that report and fix silent drift (#159, Phase 2 of #156).

**Architecture:**
- A new pure core module renders both rule tiers inside versioned markers and parses existing files (versioned, unversioned and pre-marker legacy blocks). The writer, the dry run and the doctor all use it.
- `ctxo init` resolves a set of parts and runs one ordered pipeline (config, skills, guard, rules, MCP, git hooks) for the interactive, non-interactive and dry-run paths. The Claude Code tier is decided after skills and guard, from what is (or, in a dry run, will be) on disk.
- Three doctor checks read the same file helpers. `doctor --fix` installs missing skills and the guard, then re-renders the blocks.

**Tech Stack:** TypeScript (ESM, Node >= 20), vitest, @clack/prompts, picocolors, pnpm workspace (`packages/cli` only).

**Spec:** `docs/superpowers/specs/2026-10-20-domain-knowledge-layer-design.md`, section 9, with sections 3 (G7), 4, 5, 13.6, 15 and 18 ("Calls made in this design", PR 2A). Acceptance criteria from GitHub issue #159.

## Global Constraints

- Branch `feat/tiered-agent-rules-159` in its own worktree, stacked on the PR 0 branch `feat/cochange-engine-157` (or `master` once PR 0 is merged); it runs in parallel with PRs 1B and 1C. PR 0 provides, and this plan consumes by name: post-commit hook v2 (`# ctxo-start v2`, `ctxo index --commit HEAD`), in-place replacement of marked hook blocks in `installHook`, `resolveHooksDir(projectRoot)` in `init-command.ts`, and `GitHooksCheck` (id `git_hooks`) in `git-check.ts`, registered in `doctor-command.ts`.
- Hexagonal rules: `core/` never imports from `adapters/` or `ports/`; `ports/` never imports from `adapters/`; the composition root wires adapters; no barrel exports; every adapter implements a port. Doctor checks may import file helpers from `cli/` (precedent: `versions-check.ts` imports `cli/version-command.js`).
- No `console.log` (eslint bans it). CLI human output goes to `console.error`, JSON to `process.stdout.write`, library logs through `createLogger('ctxo:<ns>')`.
- Tests are co-located in `__tests__/` and use vitest. New test file names are kebab-case with no extra dots (the repo's `.claude/hooks/check-file-naming.sh` rejects `a.b.test.ts`). Temp dirs come from `mkdtempSync(join(tmpdir(), 'ctxo-...'))`. Every git operation that creates commits in a temp repo (commit, merge, rebase, cherry-pick, amend, revert, tag) passes `-c commit.gpgsign=false -c user.name=Test -c user.email=test@test.com`, plus `-c tag.gpgsign=false` for tags. Never run `ctxo init` or `ctxo doctor --fix` against the worktree itself.
- Spec values (section 9):
  - The compact tier is at most 8 lines including the heading. It is written for Claude Code only when the guard hook and the skills are installed; every other client gets the full tier.
  - Narrowed wording, verbatim: "For structural questions (dependencies, impact, history), use ctxo tools first; reading a file to see its contents needs no index call."
  - Markers: `<!-- ctxo-rules-start v<cli minor> -->` and `<!-- ctxo-rules-end -->`. Unversioned `<!-- ctxo-rules-start -->` blocks are recognised and replaced in place, never appended twice.
  - Init parts: `rules`, `skills`, `guard`, `mcp`, `git-hooks`, `config` (`domain` joins in PR 2B). `--rules` is a deprecated alias for `--skip git-hooks,guard` and prints a notice. `--no-guard` opts out of the guard, which stays on by default for Claude Code.
  - Doctor check ids: `ai_rules`, `skills`, `claude_guard_hook` (new) and `git_hooks` (PR 0), each fixed by `ctxo doctor --fix`.
  - Guard entry (unchanged): `{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "ctxo gate-hook" }] }` in `.claude/settings.json`. A corrupt `.claude/settings.json` is never overwritten; `ensureClaudeHook` warns and leaves it.
- Before editing an existing symbol, call the ctxo MCP tools `get_blast_radius` and `get_why_context` on it (project rule; the safe-edit guard enforces it for high-impact symbols). The session's ctxo MCP server indexes the main checkout (older code), so `found: false` from either tool for a symbol added on these branches is expected: call the tools as the project rule asks, then proceed.
- Repo text in English, no em dashes in anything new: generated rules, skills, CLI output, docs. The only em dashes allowed are `\u2014` escapes inside the two legacy constants used for matching (Task 1).
- Commits: stage explicit paths only, never `.ctxo/` or `.claude/settings.local.json`. Commits are GPG-signed (`git commit -S`); if signing fails, stop and report BLOCKED. No `Co-Authored-By` lines. No push, PR, publish or issue comment without the owner's approval.
- Privacy: nothing from any private repository (fixture code, paths, names, business terms) in code, tests, docs, commits or PR text; aggregate numbers only.

## Review Focus

1. **Windows files: CRLF line endings (`core.autocrlf`) and a UTF-8 BOM** in `CLAUDE.md`, `AGENTS.md` and installed skills. Expected: markers and the legacy body are still found, the block is replaced in place with the file's line endings and BOM kept, and a skill that differs only in line endings is neither reported outdated nor rewritten. Tests: Task 1 `upsertRulesBlock keeps CRLF line endings and a UTF-8 BOM`, Task 3 `installSkills skips a skill that differs only in line endings`, Task 8 `skills does not report CRLF copies as outdated`.
2. **Mixed ctxo versions in one team:** a block written by a newer ctxo (a teammate upgraded first). Expected: an older CLI leaves it unchanged with a warning, and doctor does not call it outdated, so two teammates never flip the block back and forth. Tests: Task 1 `upsertRulesBlock leaves a block from a newer template alone`, Task 2 `a block from a newer ctxo is left unchanged with a warning`, Task 8 `ai_rules does not report a block from a newer ctxo`.
3. **A deliberate opt-out** (`--no-guard`, `--skip skills`, or `gate.enabled: false`). Expected: the rules use the full block, doctor reports no missing guard or skills, and `doctor --fix` installs nothing the user declined. Tests: Task 4 `resolveRulesTier is compact only with the guard, every skill and an enabled gate on disk`, Task 6 `gate.enabled false gives Claude Code the full block`, Task 8 `ai_rules accepts a current full block without the guard as an opt-out`, Task 9 `--fix leaves a deliberate opt-out alone`.
4. **A damaged block:** a start marker without an end marker, or two ctxo blocks in one file (older versions appended a marked block after the unmarked one they wrote into a new `CLAUDE.md`). Expected: an unterminated block leaves the file byte-for-byte unchanged with a warning naming the file; two blocks collapse into one at the first position, and the text between them is kept. Tests: Task 1 `upsertRulesBlock collapses two blocks into one at the first position` and `scanRulesBlocks flags a start marker without an end marker`, Task 2 `an unterminated block is left byte-for-byte unchanged with a warning`, Task 8 `ai_rules reports duplicate and unterminated blocks`.
5. **A `.claude/settings.json` that parses but has an unexpected shape** (`null`, an array, a string, `hooks` as an array, `PreToolUse` as an object) or contains JSONC comments. Expected: treated like corrupt JSON: no crash, file unchanged, a warning from `ctxo init` and a doctor warning. Tests: Task 4 `ensureClaudeHook treats valid JSON with an unexpected shape like corrupt JSON`, Task 8 `claude_guard_hook warns on unreadable settings`.

## Designer calls

The spec leaves these open; each is the plan's decision and the owner may override it.

- **D1 Template version constant.** `RULES_TEMPLATE_VERSION` is a hand-set constant equal to the CLI minor in which the template last changed (initially the spec draft's `0.13`, confirmed against `pnpm changeset status` in Task 10). It is not read from `package.json` at runtime, so a CLI minor that does not touch the template does not mark every committed block outdated.
- **D2 Outdated versus newer.** A block is outdated when it has no version, an older version, or the current version with an edited body. A block with a newer version is never outdated; `installRules` leaves it unchanged with a warning.
- **D3 Legacy recognition.** The pre-tier unmarked body is recognised verbatim and replaced in place. `ruleBody()` and `cursorFrontmatter()` never changed across the 11 commits that touched `ai-rules.ts`, so one constant each covers every shipped version. This keeps upgrades of create-mode files, and of `CLAUDE.md`/`GEMINI.md` files created without markers, from duplicating the rules.
- **D4 Gate setting.** The compact tier also requires `gate.enabled !== false`: a disabled gate cannot back the compact block's claim that a guard blocks edits.
- **D5 Opt-out record.** No config is written for `--no-guard`. A versioned full block (written by a tier-aware ctxo without the guard), or `gate.enabled: false`, records that the user declined. Doctor reports the guard or the skills as missing only for unversioned (pre-tier) and compact blocks.
- **D6 Full-tier wording.** Besides the spec's sentence, step 3 becomes "Only then edit the source" (reading needs no index call), and each em dash becomes a colon, comma or semicolon. The heading stays, so tier detection reads the first line.
- **D7 One write mode.** `Platform.mode` is removed. Every platform file is upserted the same way; only Cursor's file gets frontmatter, when it is created or when its legacy frontmatter is found.
- **D8 Damaged blocks.** An unterminated start marker leaves the file unchanged with a warning. Several blocks collapse into one at the first position.
- **D9 Parts boundaries.** `config` covers `.ctxo/config.yaml`, the `.gitignore` entry and `.ctxo/index/`. The language-plugin install is not a part: `--only` skips it, `--skip` keeps it (subject to `--no-install`), and `--rules` keeps skipping it as it always did.
- **D10 Flag combinations.** `--only` cannot be combined with `--skip` or `--rules`. `--skip`, `--rules` and `--no-guard` combine by union. Unknown parts exit 1. An empty selection prints a notice and exits 0.
- **D11 Local settings.** Guard detection also reads `.claude/settings.local.json` (read only, never written), so a hook moved there is not duplicated.
- **D12 Unexpected JSON shapes.** `ensureClaudeHook` treats valid JSON with an unexpected shape like corrupt JSON. `ensureMcpConfig` keeps its current overwrite of corrupt MCP JSON, because the spec names only `.claude/settings.json`.
- **D13 Fix order.** `doctor --fix` runs Config, Git hooks, Skills, Claude guard hook, AI rules, then plugins, index and cache. AI rules re-render whenever any of the three agent checks failed, so the tier follows the fixes in the same run.
- **D14 Repo's own files.** The repo's own `CLAUDE.md` ctxo block and `.github/copilot-instructions.md` are not regenerated in this PR (the owner's dogfooding choice).
- **D15 Skill guide.** `ctxo-understand` gets the selection guide as a question-to-tool table covering all 14 tools. Its description drops "before reading source files" to match the narrowed wording.
- **D16 Output format.** Init output lines drop the em dash: `[ctxo] ✓ <file> (<created|updated|unchanged>)`, with warnings as `[ctxo] ⚠ <text>`. A dry run without `--tools` previews every platform, as today.

## Out of scope (noted for the owner)

- `ensureMcpConfig` still overwrites corrupt MCP JSON (`.mcp.json`, `.gemini/settings.json`); same failure class, not named by the spec.
- `ctxo init --help` starts an interactive init (the router has no per-command help for `init`).
- `site/docs/reference/ci-integration.md` claims `ctxo init` installs a pre-push hook.
- The #159 Grep hint and the Cursor stop-hook reminder stay deferred (spec section 17).

## File map

| File | Responsibility |
|---|---|
| `packages/cli/src/core/agent-rules/rules-block.ts` (new) | Tier texts, markers, block scan and upsert, block classification, tier policy (pure) |
| `packages/cli/src/cli/ai-rules.ts` | File writers (rules, skills, guard, config, gitignore, MCP, index dir) with dry run; disk-state readers for init and doctor |
| `packages/cli/src/cli/init-parts.ts` (new) | Parts list, flag parsing and resolution (pure) |
| `packages/cli/src/cli/init-command.ts` | One ordered pipeline for interactive, non-interactive and dry-run init |
| `packages/cli/src/cli/cli-router.ts` | `init` flags and help |
| `packages/cli/src/adapters/diagnostics/checks/agent-setup-check.ts` (new) | `ai_rules`, `skills`, `claude_guard_hook` checks |
| `packages/cli/src/cli/doctor-command.ts`, `doctor-fix.ts` | Check registration and remediation |
| `packages/cli/skills/ctxo-understand/SKILL.md` | Tool selection guide |

---

### Task 0: Branch setup

- [ ] **Step 1:** Create the worktree with superpowers:using-git-worktrees: branch `feat/tiered-agent-rules-159`, based on the tip of the PR 0 branch `feat/cochange-engine-157` (or `master` once PR 0 is merged).
- [ ] **Step 2:** Add this plan. It lives under the gitignored `docs/superpowers/`; copy it from the checkout where it was written if the worktree lacks it. Run `git add -f docs/superpowers/plans/2026-10-21-pr2a-tiered-agent-rules.md`. The spec was committed by PR 0.
- [ ] **Step 3:** `git commit -S -m "docs: add PR 2A tiered agent rules plan"`.
- [ ] **Step 4:** `pnpm install --frozen-lockfile && pnpm -r build`. Expected: success.
- [ ] **Step 5:** Confirm the PR 0 pieces this plan consumes:
  - `git grep -n -e "resolveHooksDir" -e "ctxo-start v2" -- packages/cli/src/cli/init-command.ts`
  - `git grep -n "git_hooks" -- packages/cli/src/adapters/diagnostics/checks/git-check.ts packages/cli/src/cli/doctor-command.ts`

  Expected: matches in each file. If any is missing, stop and report BLOCKED.
- [ ] **Step 6:** Baseline: `pnpm --filter @ctxo/cli test:unit`. Expected: all pass; note the count for the PR description.

---

### Task 1: Rule tiers and the rules block parser (pure core)

**Files:**
- Create: `packages/cli/src/core/agent-rules/rules-block.ts`
- Test: `packages/cli/src/core/agent-rules/__tests__/rules-block.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RulesTier = 'compact' | 'full';
  export const RULES_TEMPLATE_VERSION: string;   // 'M.m'; '0.13' until Task 10 confirms it (D1)
  export function ruleBody(options: { readonly tier: RulesTier }): string;   // no trailing newline
  export function renderRulesBlock(tier: RulesTier): string;   // start marker, body, end marker joined by '\n'; no trailing newline
  export const LEGACY_RULE_BODY: string;            // the pre-PR ruleBody() text, verbatim
  export const LEGACY_CURSOR_FRONTMATTER: string;   // the pre-PR cursorFrontmatter() text, verbatim
  export interface RulesBlockSpan {
    readonly start: number; readonly end: number;   // [start, end) in the normalised text; end is right after the end marker (or the legacy body)
    readonly marked: boolean;                       // false: the legacy body found without markers
    readonly version?: string;                      // 'M.m' from the start marker; absent when unversioned, malformed or legacy
    readonly body: string;                          // text between the marker lines ('\n' line breaks)
  }
  export interface RulesScan { readonly blocks: readonly RulesBlockSpan[]; readonly unterminated: boolean }
  export function scanRulesBlocks(content: string): RulesScan;   // strips a leading BOM and normalises \r\n first
  export type UpsertResult =
    | { readonly kind: 'inserted' | 'replaced' | 'unchanged'; readonly content: string }
    | { readonly kind: 'unterminated' }
    | { readonly kind: 'newer'; readonly version: string };
  export function upsertRulesBlock(existing: string, block: string): UpsertResult;
  export function compareTemplateVersions(a: string, b: string): number;   // numeric major, then minor
  export function blockTier(body: string): RulesTier | 'unknown';   // first line '## ctxo': compact; starts with '## ctxo MCP Tool Usage': full
  export type BlockStatus =
    | { readonly state: 'current'; readonly tier: RulesTier }
    | { readonly state: 'outdated'; readonly reason: 'unversioned' | 'older' | 'edited'; readonly tier: RulesTier | 'unknown' }
    | { readonly state: 'newer'; readonly version: string; readonly tier: RulesTier | 'unknown' };
  export function classifyRulesBlock(block: RulesBlockSpan): BlockStatus;
  export interface TierFacts { readonly guardPresent: boolean; readonly skillsComplete: boolean; readonly gateEnabled: boolean }
  export function expectedRulesTier(platformId: string, facts: TierFacts): RulesTier;   // compact iff 'claude-code' and all three facts (D4)
  export function guardAndSkillsExpected(block: RulesBlockSpan | undefined): boolean;   // D5: !marked, no version, or blockTier(body) === 'compact'
  ```

- [ ] **Step 1: Write the failing tests.**
  - `the compact block is at most 8 lines including the heading and both markers` (#159 acceptance): `renderRulesBlock('compact').split('\n').length <= 8`; line 2 is `## ctxo`.
  - `the compact body is the spec draft`: `ruleBody({ tier: 'compact' })` equals the four lines in Step 3 verbatim.
  - `the full body differs from the legacy body in exactly the eight listed lines`: same line count as `LEGACY_RULE_BODY`; 8 differing lines; it contains the narrowed sentence and not `ALWAYS use ctxo MCP tools before reading source files`.
  - `no new template text contains an em dash`: neither body matches `/\u2014/`.
  - `renderRulesBlock wraps the body in versioned markers`: the first line is `<!-- ctxo-rules-start v${RULES_TEMPLATE_VERSION} -->` and the last is `<!-- ctxo-rules-end -->`; `RULES_TEMPLATE_VERSION` matches `/^\d+\.\d+$/`. Tests reference the constant, never the literal.
  - `scanRulesBlocks reads versioned and unversioned markers`: blocks with `version: '0.9'` and `version: undefined`, both `marked: true`, sorted by `start`.
  - `scanRulesBlocks finds the legacy body without markers but not inside a marked block`: `'# Mine\n\n' + LEGACY_RULE_BODY + '\n'` gives one `marked: false` block. An old marked block whose body is `LEGACY_RULE_BODY` gives exactly one block, `marked: true`.
  - `scanRulesBlocks flags a start marker without an end marker` (Review Focus 4): `unterminated === true`.
  - ``scanRulesBlocks ignores a marker that is not on its own line``: ``'see `<!-- ctxo-rules-start -->` here\n'`` gives no blocks.
  - `upsertRulesBlock replaces an unversioned block in place and keeps the text around it`: `'Intro\n\n<!-- ctxo-rules-start -->\nold\n<!-- ctxo-rules-end -->\n\nOutro\n'` becomes `'Intro\n\n' + block + '\n\nOutro\n'`, kind `replaced`.
  - `upsertRulesBlock appends once, then reports unchanged`: `'# P\n'` becomes `'# P\n\n' + block + '\n'`; a second call returns `unchanged` with the same content (one start marker).
  - `upsertRulesBlock replaces the legacy body in place`: `'Top\n\n' + LEGACY_RULE_BODY + '\n\nBottom\n'` becomes `'Top\n\n' + block + '\n\nBottom\n'`.
  - `upsertRulesBlock collapses two blocks into one at the first position` (Review Focus 4): `LEGACY_RULE_BODY + '\n\nUser notes\n\n<!-- ctxo-rules-start -->\n' + LEGACY_RULE_BODY + '\n<!-- ctxo-rules-end -->\n'` becomes `block + '\n\nUser notes\n'`.
  - `upsertRulesBlock leaves an unterminated block alone`: kind `unterminated`.
  - `upsertRulesBlock leaves a block from a newer template alone` (Review Focus 2): a `v99.0` marker gives `{ kind: 'newer', version: '99.0' }`.
  - `upsertRulesBlock keeps CRLF line endings and a UTF-8 BOM` (Review Focus 1): `'\uFEFF<!-- ctxo-rules-start -->\r\nold\r\n<!-- ctxo-rules-end -->\r\nUser\r\n'` gives content that starts with `'\uFEFF<!-- ctxo-rules-start v'`, ends with `'\r\nUser\r\n'`, has no `\n` without a preceding `\r`, and has one start marker.
  - `classifyRulesBlock covers current, edited, older, unversioned, legacy and newer blocks` (table): a current compact block gives `{ state: 'current', tier: 'compact' }`; the current version with an edited body gives `outdated/edited`; `v0.1` gives `outdated/older`; unversioned and legacy give `outdated/unversioned` with tier `full`; `v99.0` gives `newer`.
  - `expectedRulesTier is compact only for claude-code with the guard, every skill and an enabled gate`: all 8 fact combinations for `claude-code`, plus `cursor` with all facts true, which gives `full`.
  - `guardAndSkillsExpected is true for legacy, unversioned and compact blocks and false for a versioned full block or none`.
  - `compareTemplateVersions compares numerically`: `('0.9', '0.13') < 0`, `('0.13', '0.13') === 0`, `('1.0', '0.13') > 0`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/agent-rules`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `rules-block.ts`** (no imports from `adapters/`, `ports/` or `node:fs`).
  - Compact body, verbatim from the spec draft:
    ```markdown
    ## ctxo
    This repo has a ctxo index: dependency graph, git intent, change health. For structural questions (who depends on X, what breaks if X changes, why X looks like this), use the ctxo MCP tools before grepping.
    A pre-edit guard blocks the first edit to a high-impact symbol until `get_blast_radius` has been called for it.
    Skills: `ctxo-understand` (orient at task start), `ctxo-safe-edit` (before changing a symbol), `ctxo-review-pr` (before reviewing a diff).
    ```
  - Full body: `LEGACY_RULE_BODY` with exactly these eight line replacements (D6); every other line, the heading included, stays:

    | Legacy line (start) | New line |
    |---|---|
    | `**ALWAYS use ctxo MCP tools before reading source files or making code changes.**` (first sentence of the paragraph) | `**For structural questions (dependencies, impact, history), use ctxo tools first; reading a file to see its contents needs no index call.**` (rest of the paragraph unchanged) |
    | `` 1. Call `get_blast_radius` `` | `` 1. Call `get_blast_radius` for the symbol you are about to change, to see what breaks `` |
    | `` 2. Call `get_why_context` `` | `` 2. Call `get_why_context` for the same symbol, to check for revert history or anti-patterns `` |
    | `3. Only then read and edit source files` | `3. Only then edit the source` |
    | `` - Call `get_pr_impact` `` | `` - Call `get_pr_impact`: a single call gives a full risk assessment with co-change analysis `` |
    | `` - Use `search_symbols` `` | `` - Use `search_symbols` for name/regex lookup; DO NOT grep source files for symbol discovery `` |
    | `` - Use `get_ranked_context` `` | `` - Use `get_ranked_context` for natural language queries; DO NOT manually browse directories `` |
    | `` - NEVER skip `get_why_context` `` | `` - NEVER skip `get_why_context`: reverted code and anti-patterns are invisible without it `` |
  - Legacy constants (D3): copy the template literal of `ruleBody()` (`packages/cli/src/cli/ai-rules.ts` lines 90-122) and of `cursorFrontmatter()` (lines 130-136) verbatim, writing each em dash as `\u2014`. Task 2 deletes the originals.
  - Markers: start `/^<!-- ctxo-rules-start(?: v(\S+))? -->[ \t]*$/gm`; the version counts only when it matches `/^\d+\.\d+$/`. End `/^<!-- ctxo-rules-end -->[ \t]*$/m`, the first one after the start. A start with no end before the next start, or before the end of the text, sets `unterminated`. Legacy spans are exact occurrences of `LEGACY_RULE_BODY` outside marked spans.
  - `upsertRulesBlock`:
    1. Remember and strip a leading BOM. Remember whether the text contains `\r\n`, then normalise it to `\n`.
    2. Scan. Return `unterminated` if set. Return `newer` if any block's version compares above `RULES_TEMPLATE_VERSION`.
    3. With no block, append: empty text becomes `block + '\n'`; otherwise use `text + (text.endsWith('\n') ? '\n' : '\n\n') + block + '\n'`.
    4. With blocks, replace the first span with `block`. Delete every later span together with the line break after it, and, when a blank line preceded the span, one line break before it.
    5. Restore CRLF and the BOM. Return `unchanged` (with the original string) when the result equals the input.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/cli/src/core/agent-rules/rules-block.ts packages/cli/src/core/agent-rules/__tests__/rules-block.test.ts
  git commit -S -m "feat(core): tiered ctxo rule bodies and a versioned rules block parser (#159)"
  ```

---

### Task 2: The rules writer upserts every platform file

**Files:**
- Modify: `packages/cli/src/cli/ai-rules.ts` (`Platform` and `PLATFORMS` lines 48-70, markers lines 82-83, `ruleBody` and `cursorFrontmatter` lines 85-137, `generateRules` lines 139-147, `InstallResult` and `installRules` lines 153-196, `escapeRegExp` lines 198-200)
- Modify: `packages/cli/src/cli/init-command.ts` (`dryRun` only: replace the `platform.mode` lookup with `installRules(this.projectRoot, id, { dryRun: true }).action`; Task 7 rewrites the method)
- Test: `packages/cli/src/cli/__tests__/ai-rules.test.ts`

**Interfaces:**
- Consumes: `ruleBody`, `renderRulesBlock`, `upsertRulesBlock`, `LEGACY_CURSOR_FRONTMATTER`, `RulesTier` (Task 1).
- Produces:
  ```ts
  export interface InstallResult { file: string; action: 'created' | 'updated' | 'skipped'; warning?: string }   // file: project-relative, forward slashes
  export interface Platform { id: string; name: string; file: string; detectPaths: string[]; starred: boolean }   // `mode` removed (D7)
  export function generateRules(platformId: string, tier?: RulesTier): string;   // content of a new file; tier defaults to 'full'
  export function installRules(projectRoot: string, platformId: string, options?: { readonly tier?: RulesTier; readonly dryRun?: boolean }): InstallResult;
  ```

- [ ] **Step 1: Write the failing tests.**
  - Update existing tests:
    - delete `includes claude-code as append mode`;
    - marker assertions expect `<!-- ctxo-rules-start v${RULES_TEMPLATE_VERSION} -->`;
    - the idempotence test counts `/<!-- ctxo-rules-start/g`.
  - `a new rules file gets one versioned marked block for every platform`: `it.each(PLATFORMS)` in an empty dir gives `created` and exactly one start marker.
  - `a second run on a new CLAUDE.md is skipped and keeps one block`: this is the old bug, where a new `CLAUDE.md` had no markers and the next run appended a second copy.
  - `create-mode files keep user content outside the block`: `AGENTS.md` = `'# Team rules\nBe kind.\n'`, then `installRules(dir, 'antigravity')` gives `updated` and content `'# Team rules\nBe kind.\n\n' + renderRulesBlock('full') + '\n'`.
  - `reports created, then skipped, then updated when the tier changes`: `windsurf` run three times (the last with `tier: 'compact'`) gives `created`, `skipped`, `updated` (the `existsSync`-after-write bug).
  - `replaces an existing marked block in place, never appending a second one (#159 acceptance)`: `CLAUDE.md` = `'Intro\n\n<!-- ctxo-rules-start -->\nold\n<!-- ctxo-rules-end -->\n\nOutro\n'` becomes `'Intro\n\n' + renderRulesBlock('full') + '\n\nOutro\n'`.
  - `upgrades legacy files from earlier ctxo versions without duplicating the rules`: `.windsurfrules` = `LEGACY_RULE_BODY + '\n'` becomes `renderRulesBlock('full') + '\n'`; `.cursor/rules/ctxo.mdc` = `LEGACY_CURSOR_FRONTMATTER + LEGACY_RULE_BODY + '\n'` becomes `generateRules('cursor')`.
  - `writes the compact tier when asked`: `installRules(dir, 'claude-code', { tier: 'compact' })` writes a block of at most 8 lines.
  - `dryRun reports the action and writes nothing`: `installRules(dir, 'cursor', { dryRun: true })` gives `created`, and `.cursor/` does not exist.
  - `an unterminated block is left byte-for-byte unchanged with a warning` (Review Focus 4): `skipped`, warning contains `no end marker`.
  - `a block from a newer ctxo is left unchanged with a warning` (Review Focus 2): `skipped`, warning contains `newer ctxo`.
  - `the generated Cursor frontmatter has no em dash`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/ai-rules.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - A missing file gets `generateRules(id, tier)`: Cursor gets the new frontmatter, then the block and `'\n'`; every other platform gets the block and `'\n'`. Action `created`.
  - An existing file gets `upsertRulesBlock(existing, renderRulesBlock(tier))`. For Cursor, a leading `LEGACY_CURSOR_FRONTMATTER` (after BOM and CRLF normalisation) is also swapped for the new frontmatter.
  - Map the upsert result: `inserted` or `replaced` gives `updated`; `unchanged` gives `skipped`. `unterminated` gives `skipped` plus the warning `${file}: ctxo rules start marker has no end marker; left unchanged`. `newer` gives `skipped` plus `${file}: rules block v${version} comes from a newer ctxo; left unchanged`.
  - The new Cursor frontmatter is the legacy one with `description: ctxo MCP tool usage rules, always applied`.
  - `dryRun` computes the same action, writes nothing and creates no directory.
  - Delete `SECTION_START`, `SECTION_END`, `escapeRegExp`, the old `ruleBody`, `Platform.mode` and the `mode` column of `PLATFORMS`.
- [ ] **Step 4: Run the tests.** Expected: PASS. Then `pnpm --filter @ctxo/cli typecheck`. Expected: clean.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/cli/src/cli/ai-rules.ts packages/cli/src/cli/init-command.ts packages/cli/src/cli/__tests__/ai-rules.test.ts
  git commit -S -m "fix(init): marked blocks in every rules file, user content kept, honest created/updated actions (#159)"
  ```

---

### Task 3: Skills: the selection guide and an idempotent installer

**Files:**
- Modify: `packages/cli/skills/ctxo-understand/SKILL.md` (whole file)
- Modify: `packages/cli/src/cli/ai-rules.ts` (`SKILLS`, `SKILL_TARGET_DIR`, `skillsSourceDir`, `installSkills`, lines 206-240)
- Test: `packages/cli/src/cli/__tests__/ai-rules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SKILL_PLATFORMS: readonly ['claude-code', 'cursor'];
  export function installSkills(projectRoot: string, platformId: string, options?: { readonly dryRun?: boolean }): InstallResult[];
  // 'skipped' when the installed file equals the bundled one (BOM and line endings ignored); file is project-relative
  export interface SkillState { readonly skill: (typeof SKILLS)[number]; readonly file: string; readonly state: 'current' | 'missing' | 'outdated' }
  export function skillStates(projectRoot: string, platformId: string): SkillState[];   // [] for platforms without skills
  ```

- [ ] **Step 1: Write the failing tests.**
  - `ctxo-understand carries the tool selection guide for all 14 tools`: the bundled file contains `## Which tool for which question` and each of `get_logic_slice`, `get_blast_radius`, `get_architectural_overlay`, `get_why_context`, `get_change_intelligence`, `find_dead_code`, `get_context_for_task`, `get_ranked_context`, `search_symbols`, `get_changed_symbols`, `find_importers`, `get_class_hierarchy`, `get_symbol_importance`, `get_pr_impact`.
  - `no bundled skill contains an em dash`.
  - `installSkills skips a skill that differs only in line endings` (Review Focus 1): pre-write each bundled skill with `\r\n`. Expect all `skipped` and bytes unchanged.
  - `installSkills rewrites an edited skill and reports updated`.
  - `installSkills returns project-relative paths and writes nothing in dryRun`: `file === '.claude/skills/ctxo-safe-edit/SKILL.md'`; with `dryRun` no `.claude/` directory appears.
  - `skillStates reports missing, outdated and current skills`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/ai-rules.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Write `packages/cli/skills/ctxo-understand/SKILL.md` exactly as follows (D15):
    ```markdown
    ---
    name: ctxo-understand
    description: Use at the START of any code task (fix, extend, refactor, understand), and whenever you need the right ctxo tool for a structural question, to orient with ctxo instead of going in the wrong direction.
    ---

    # Orient with ctxo before diving in

    At the start of a new task:

    1. `get_context_for_task` with the matching taskType (fix | extend | refactor | understand).
    2. For unfamiliar areas: `get_architectural_overlay` (layer map) and `get_symbol_importance` (critical symbols).
    3. Don't know the symbol name? `search_symbols` (name/regex) or `get_ranked_context` (natural language) before grepping or browsing directories.

    Then read the files ctxo points you to. Reading a file to see its contents needs no index call.

    ## Which tool for which question

    | Question | Tool |
    |---|---|
    | Reviewing a PR or recent changes | `get_pr_impact` (one call: changed symbols, blast radius, co-change) |
    | What breaks if I change this symbol? | `get_blast_radius`, then `get_why_context` |
    | Why does this code look like this? Any reverts? | `get_why_context` |
    | What does this symbol do and depend on? | `get_context_for_task(taskType: "understand")` or `get_logic_slice` (L2 overview, L3 full closure) |
    | Fixing a bug | `get_context_for_task(taskType: "fix")` |
    | Adding or extending a feature | `get_context_for_task(taskType: "extend")` |
    | Refactoring | `get_context_for_task(taskType: "refactor")` |
    | Who uses this? Is it safe to delete or rename? | `find_importers`, then `get_blast_radius` |
    | Class inheritance (extends, implements) | `get_class_hierarchy` |
    | Unused symbols and files | `find_dead_code` |
    | Complexity and churn hotspots | `get_change_intelligence` |
    | Symbols in recently changed files | `get_changed_symbols` |
    | Find a symbol by name or regex | `search_symbols` |
    | Find code for a natural-language question | `get_ranked_context` |
    | Layer map of the project | `get_architectural_overlay` |
    | Most central symbols | `get_symbol_importance` |
    ```
  - `installSkills` compares the normalised existing content with the bundled content before writing. The `file` field becomes `relative(projectRoot, to)` with forward slashes.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/cli/skills/ctxo-understand/SKILL.md packages/cli/src/cli/ai-rules.ts packages/cli/src/cli/__tests__/ai-rules.test.ts
  git commit -S -m "feat(skills): tool selection guide in ctxo-understand and an idempotent skill installer (#159)"
  ```

---

### Task 4: The guard hook writer and tier resolution

**Files:**
- Modify: `packages/cli/src/cli/ai-rules.ts` (`ensureClaudeHook`, lines 15-46; new helpers next to it)
- Test: `packages/cli/src/cli/__tests__/ai-rules.test.ts`

**Interfaces:**
- Consumes: `expectedRulesTier` (Task 1), `skillStates` (Task 3), `loadConfig` (`packages/cli/src/core/config/load-config.ts`).
- Produces:
  ```ts
  export type ClaudeGuardState = 'present' | 'absent' | 'unreadable';
  export function readClaudeGuardState(projectRoot: string): ClaudeGuardState;
  export function ensureClaudeHook(projectRoot: string, options?: { readonly dryRun?: boolean }): InstallResult;
  export function gateEnabled(projectRoot: string): boolean;   // loadConfig(join(projectRoot, '.ctxo')).config.gate?.enabled !== false
  export function resolveRulesTier(projectRoot: string, platformId: string,
    planned?: { readonly guard?: boolean; readonly skills?: boolean }): RulesTier;
  // guardPresent = planned.guard === true || readClaudeGuardState(root) === 'present'
  // skillsComplete = planned.skills === true || no skillStates(root, 'claude-code') entry is 'missing'
  ```
- Rules:
  - `present`: some `hooks.PreToolUse[].hooks[].command === 'ctxo gate-hook'` in `.claude/settings.json` or `.claude/settings.local.json`. The local file is read, never written (D11).
  - `unreadable`: `.claude/settings.json` exists and the hook is not in the local file, and the file fails `JSON.parse`, or is not a plain object, or has a `hooks` that is not a plain object, or has a `hooks.PreToolUse` that is not an array.
  - `ensureClaudeHook`:
    - `present` gives `skipped`;
    - `unreadable` gives `skipped` plus the warning `.claude/settings.json is not valid JSON or not a settings object; left unchanged. Fix it, then run "ctxo init --only guard".` and never writes;
    - a missing file gives `created`;
    - otherwise append the entry and return `updated`;
    - `dryRun` writes nothing and creates no directory.

- [ ] **Step 1: Write the failing tests.**
  - `ensureClaudeHook leaves a corrupt settings.json unchanged and warns`: `'not json{{{'` gives `skipped`, a warning matching `/not valid JSON/`, and unchanged bytes.
  - `ensureClaudeHook treats valid JSON with an unexpected shape like corrupt JSON` (Review Focus 5): `it.each(['null', '[]', '"text"', '{"hooks":[]}', '{"hooks":{"PreToolUse":{}}}', '{\n  // comment\n}'])`. Expect no throw, `skipped`, a warning, unchanged bytes.
  - `ensureClaudeHook keeps other settings and hooks when it adds the guard`: start from `permissions`, a `PreToolUse` `Write` entry and a `PostToolUse` entry. All are preserved, and the ctxo entry is appended last to `PreToolUse`.
  - `ensureClaudeHook does not duplicate a guard registered in settings.local.json`: `skipped`, and `.claude/settings.json` is not created.
  - `ensureClaudeHook dryRun writes nothing`.
  - `readClaudeGuardState reports present, absent and unreadable`.
  - `resolveRulesTier is compact only with the guard, every skill and an enabled gate on disk` (Review Focus 3):
    - guard and skills present gives `compact`;
    - adding `.ctxo/config.yaml` with `gate:\n  enabled: false\n` gives `full`;
    - deleting one skill gives `full`;
    - `cursor` gives `full`.
  - `resolveRulesTier counts planned guard and skills`: an empty dir with `{ guard: true, skills: true }` gives `compact`.
  - Existing `creates .claude/settings.json with a PreToolUse Edit hook` and `is idempotent` keep passing.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/ai-rules.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** per the rules above. Use one private `readSettings(path)` that returns `{ kind: 'missing' | 'unreadable' } | { kind: 'ok'; json; hasHook }`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/cli/src/cli/ai-rules.ts packages/cli/src/cli/__tests__/ai-rules.test.ts
  git commit -S -m "fix(init): never overwrite an unreadable .claude/settings.json; resolve the rules tier from disk (#159)"
  ```

---

### Task 5: Init parts and CLI flags

**Files:**
- Create: `packages/cli/src/cli/init-parts.ts`
- Modify: `packages/cli/src/cli/init-command.ts` (`InitOptions` only)
- Modify: `packages/cli/src/cli/cli-router.ts` (the `init` case of `CliRouter.route`, the `ctxo init` lines of `printHelp`)
- Test: `packages/cli/src/cli/__tests__/init-parts.test.ts`, `packages/cli/src/cli/__tests__/cli-router.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // init-parts.ts
  export const INIT_PARTS = ['rules', 'skills', 'guard', 'mcp', 'git-hooks', 'config'] as const;   // 'domain' joins in PR 2B
  export type InitPart = (typeof INIT_PARTS)[number];
  export function parseInitParts(raw: string): { readonly parts: InitPart[]; readonly unknown: string[] };   // comma-split, trimmed, empties dropped, de-duplicated in input order
  export interface InitPartFlags { readonly only?: readonly InitPart[]; readonly skip?: readonly InitPart[]; readonly noGuard?: boolean; readonly rulesOnly?: boolean }
  export function resolveInitParts(flags: InitPartFlags): Set<InitPart>;   // only: those parts; else all minus skip, minus git-hooks and guard for rulesOnly; noGuard always removes guard
  export function pluginStepEnabled(flags: { readonly only?: readonly InitPart[]; readonly rulesOnly?: boolean; readonly noInstall?: boolean }): boolean;   // D9: !only && !rulesOnly && !noInstall
  // init-command.ts: InitOptions gains
  only?: InitPart[]; skip?: InitPart[]; noGuard?: boolean;   // rulesOnly stays, documented as the deprecated alias
  ```
- Router messages (exact), each followed by `process.exit(1)` before `InitCommand` is constructed:
  - `[ctxo] --only requires a comma-separated list of parts: rules, skills, guard, mcp, git-hooks, config` (same for `--skip`), when the value is missing or starts with `--`;
  - `[ctxo] Unknown init part: <name>. Valid parts: rules, skills, guard, mcp, git-hooks, config`;
  - `[ctxo] --only cannot be combined with --skip or --rules` (D10).
- `printHelp`: replace the four `ctxo init` lines with:
  ```
    ctxo init                 Interactive setup (rules, skills, guard, MCP, git hooks, config)
    ctxo init --tools a,b -y  Non-interactive (claude-code,cursor,...)
    ctxo init --only <parts>  Install only these parts: rules,skills,guard,mcp,git-hooks,config
    ctxo init --skip <parts>  Install everything except these parts
    ctxo init --no-guard      No Claude Code safe-edit guard (rules use the full block)
    ctxo init --rules         Deprecated: same as --skip git-hooks,guard
    ctxo init --dry-run       List every file init would create or change
  ```

- [ ] **Step 1: Write the failing tests.**
  - `init-parts.test.ts`:
    - `parseInitParts trims, drops empties and de-duplicates`: `' rules, skills,,rules '` gives `{ parts: ['rules', 'skills'], unknown: [] }`.
    - `parseInitParts reports unknown parts`: `'rules,hooks'` gives `unknown: ['hooks']`.
    - `resolveInitParts returns every part by default`.
    - `resolveInitParts with only selects exactly those parts`.
    - `resolveInitParts with skip removes those parts`.
    - `noGuard removes guard from only and from the default set`.
    - `rulesOnly equals skip git-hooks,guard`.
    - `pluginStepEnabled is false with only, rulesOnly or noInstall`.
  - `cli-router.test.ts`, replacing `InitCommand` with a constructible spy (the function-expression pattern of the `cli-router index co-change flags` block):
    - `passes --only, --skip and --no-guard to InitCommand.run`: `['init', '--tools', 'claude-code', '--only', 'rules,skills,guard', '-y']` gives `only: ['rules', 'skills', 'guard']`; `['init', '--skip', 'git-hooks', '--no-guard']` gives `skip: ['git-hooks'], noGuard: true`.
    - `rejects an unknown init part before constructing InitCommand`: `['init', '--only', 'rules,hooks']`.
    - `rejects --only combined with --skip or --rules`.
    - `rejects --only and --skip without a value`.
    - `help lists --only, --skip and --no-guard and marks --rules deprecated`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/init-parts.test.ts src/cli/__tests__/cli-router.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `init-parts.ts`, the router parsing and validation, and the help lines. The router passes `{ tools, yes, rulesOnly, dryRun, noInstall, only, skip, noGuard }`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/cli/src/cli/init-parts.ts packages/cli/src/cli/init-command.ts packages/cli/src/cli/cli-router.ts packages/cli/src/cli/__tests__/init-parts.test.ts packages/cli/src/cli/__tests__/cli-router.test.ts
  git commit -S -m "feat(init): --only, --skip and --no-guard flags over a parts model (#159)"
  ```

---

### Task 6: `ctxo init` runs the selected parts with tiered rules

**Files:**
- Modify: `packages/cli/src/cli/init-command.ts` (`run`, `runInteractive`, `runNonInteractive`, `installHooks`, `installHook`; new private `applyParts`)
- Modify: `packages/cli/src/cli/ai-rules.ts` (new `ensureIndexDir`)
- Test: `packages/cli/src/cli/__tests__/init-command.test.ts`; create `packages/cli/src/cli/__tests__/init-command-interactive.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 5.
- Produces:
  - `export function ensureIndexDir(projectRoot: string): InstallResult` (`file: '.ctxo/index/'`; `created` or `skipped`).
  - `InitCommand.installHooks(): InstallResult[]`: one result per hook (`post-commit`, `post-merge`) in PR 0's `resolveHooksDir`. `file` is relative to the project root with forward slashes, or the absolute path when the hooks directory lies outside the repo. The action comes from comparing the old and the new hook text, and nothing is written when they are equal. `doctor-fix`'s `fixHooks` keeps calling it and ignores the result.
  - `private applyParts(parts: ReadonlySet<InitPart>, toolIds: readonly string[]): InstallResult[]`. It runs in this order, emitting nothing for parts not in the set:
    1. `config`: `ensureIndexDir`, `ensureConfig`, `ensureGitignore`;
    2. `skills`: `installSkills` per tool;
    3. `guard`: `ensureClaudeHook` when `toolIds` has `claude-code`;
    4. `rules`: `installRules` per tool with `tier: resolveRulesTier(root, id, { guard: <guard ran without a warning>, skills: <skills ran for claude-code> })`;
    5. `mcp`: `getMcpConfigTargets(toolIds)` and `ensureMcpConfig` for each;
    6. `git-hooks`: `installHooks()`.
  - Output (D16): `[ctxo] ✓ <file> (<created|updated|unchanged>)` per result, `[ctxo] ⚠ <warning>` per warning.
  - Exact notices:
    - `[ctxo] --rules is deprecated and now means --skip git-hooks,guard. Use --only or --skip instead.` (printed by `run` whenever `rulesOnly` is set);
    - `[ctxo] Nothing to install: every part is excluded.` (empty selection, exit 0, nothing written).
- Behaviour:
  - `runNonInteractive`:
    - validates the tool ids as today;
    - calls `applyParts(resolveInitParts(options), options.tools ?? [])` and prints the results;
    - runs the plugin step only when `pluginStepEnabled(options)`.
  - `runInteractive` shows a step only for selected parts, and the step counter counts only the steps it shows:
    - Index Directory: `config`.
    - AI Tools: any of `rules`, `skills`, `guard`, `mcp`; otherwise the tool list is empty.
    - Language Plugins: `pluginStepEnabled`.
    - Git Hooks: `git-hooks`; declining removes the part.
    - The guard question: `guard`, with `claude-code` selected and no `noGuard`; declining removes the part.

    The summary box lists the `applyParts` results.

- [ ] **Step 1: Write the failing tests.**
  - `init-command.test.ts`:
    - `installs the guard and skills without touching git hooks (#159 acceptance)`: `it.each([{ only: ['guard', 'skills'] }, { skip: ['git-hooks'] }])` in a real `git init` temp repo, with `tools: ['claude-code'], yes: true, noInstall: true`. Expect:
      - the hooks directory (names and contents) is identical before and after;
      - `.claude/settings.json` holds `ctxo gate-hook`;
      - all three `.claude/skills/ctxo-*/SKILL.md` exist.
    - `Claude Code with the guard and skills gets the compact block; other clients get the full block (#159 acceptance)`: `tools: ['claude-code', 'cursor', 'windsurf']`. Expect:
      - the `CLAUDE.md` block has at most 8 lines and `blockTier(...) === 'compact'`;
      - `.cursor/rules/ctxo.mdc` and `.windsurfrules` contain `ruleBody({ tier: 'full' })`.
    - `--no-guard and --skip skills give Claude Code the full block`: `it.each` over `{ noGuard: true }` and `{ skip: ['skills'] }`.
    - `gate.enabled false gives Claude Code the full block` (Review Focus 3): pre-write `.ctxo/config.yaml` with `gate:\n  enabled: false\n`.
    - `--rules prints the deprecation notice and skips only git hooks and the guard`: stderr contains `deprecated`; skills and `.mcp.json` present; `.claude/settings.json` and the post-commit hook absent; `CLAUDE.md` full.
    - `a corrupt settings.json is reported, left unchanged, and Claude Code gets the full block`.
    - `re-running init reports CLAUDE.md unchanged and keeps one block`: stderr has `CLAUDE.md (unchanged)`, and the file has one start marker.
    - `installHooks reports created, then skipped on a second run`: two results with `file` ending in `post-commit` and `post-merge`.
    - `an empty selection prints a notice and writes nothing`: `only: ['guard'], noGuard: true`.
  - `init-command-interactive.test.ts`, with `vi.mock('@clack/prompts')`. State lives in `vi.hoisted`; `confirm` records each message (ANSI stripped) and answers `true`, `multiselect` returns the test's tool list, `text` returns `'.ctxo/index'`, `isCancel` is `false`, and `spinner` is a no-op. Use `noInstall: true` throughout:
    - `does not ask about git hooks when git-hooks is skipped`: no recorded message matches `/Install hooks/`.
    - `asks the guard question only when Claude Code is selected`: with `['cursor']` no message matches `/safe-edit guard/`; with `['claude-code']` exactly one does.
    - `does not ask the guard question with --no-guard and writes the full block`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/init-command.test.ts src/cli/__tests__/init-command-interactive.test.ts`. Expected: the new tests FAIL; the existing init tests still pass.
- [ ] **Step 3: Implement** `ensureIndexDir`, the `installHooks` results, `applyParts` and the three flows per the Interfaces block.
- [ ] **Step 4: Run the tests.** Expected: PASS. Then `pnpm --filter @ctxo/cli test:unit`. Expected: all pass.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/cli/src/cli/init-command.ts packages/cli/src/cli/ai-rules.ts packages/cli/src/cli/__tests__/init-command.test.ts packages/cli/src/cli/__tests__/init-command-interactive.test.ts
  git commit -S -m "feat(init): one ordered pipeline for the selected parts, with tiered rules (#159)"
  ```

---

### Task 7: The dry run lists every file

**Files:**
- Modify: `packages/cli/src/cli/ai-rules.ts` (`ensureGitignore` lines 248-265, `ensureConfig` lines 291-303, `ensureMcpConfig` lines 356-391, `ensureIndexDir`)
- Modify: `packages/cli/src/cli/init-command.ts` (`dryRun`, `installHooks`, `installHook`, `applyParts`; new public `plan`)
- Test: `packages/cli/src/cli/__tests__/init-command.test.ts`, `packages/cli/src/cli/__tests__/ai-rules.test.ts`

**Interfaces:**
- Consumes: Task 6.
- Produces:
  - `ensureIndexDir`, `ensureGitignore` and `ensureConfig` take `(projectRoot, options?: { readonly dryRun?: boolean })`; `ensureMcpConfig` takes `(projectRoot, target, options?: { readonly dryRun?: boolean })`. In a dry run they return the action they would take, write nothing and create no directory.
  - `InitCommand.installHooks(options?: { readonly dryRun?: boolean }): InstallResult[]`: the Task 6 results; in a dry run nothing is written and no directory is created.
  - `applyParts(parts, toolIds, dryRun: boolean)`. In a dry run, `resolveRulesTier` gets the planned guard and skills.
  - `InitCommand.plan(options: InitOptions = {}): InstallResult[]` = `applyParts(resolveInitParts(options), options.tools ?? PLATFORMS.map(p => p.id), true)` (D16).
  - The dry-run output starts with the header `[ctxo] Dry run: nothing is written. Files init would touch:`. Then each result prints as `  ${file.padEnd(44)} ${'would create' | 'would update' | 'unchanged'}`, and each warning as `  ⚠ <warning>`.

- [ ] **Step 1: Write the failing tests.**
  - `--dry-run lists config, .gitignore, rules, skills for both platforms, the guard, MCP configs and git hooks`: with `tools: ['claude-code', 'cursor', 'github-copilot']`, stderr contains:
    - `.ctxo/config.yaml`, `.gitignore`, `CLAUDE.md`;
    - `.claude/skills/ctxo-safe-edit/SKILL.md`, `.cursor/rules/ctxo-understand.mdc`, `.claude/settings.json`;
    - `.mcp.json`, `.vscode/mcp.json`;
    - `post-commit`, `post-merge`.
  - `--dry-run writes nothing`: a recursive listing of the temp project is identical before and after.
  - `--dry-run follows --only and --skip`: `only: ['rules']` lists `CLAUDE.md`, but neither `.claude/settings.json` nor `post-commit`.
  - `plan lists exactly the files a real run then creates or changes`. Take the `plan({ tools: ['claude-code', 'cursor', 'github-copilot'] })` rows whose action is not `skipped` and whose `file` does not end in `/`. Then call `run({ tools: ['claude-code', 'cursor', 'github-copilot'], yes: true, noInstall: true })`. The rows must equal the set of files whose SHA-1 changed or which appeared.
  - `ensureGitignore, ensureConfig, ensureIndexDir and ensureMcpConfig write nothing in dryRun` (`ai-rules.test.ts`).
  - `installHooks dryRun returns both hooks and writes nothing`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/init-command.test.ts src/cli/__tests__/ai-rules.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** `dryRun(options)` prints `plan(options)`. Keep the `.git` check in `run` ahead of it.
- [ ] **Step 4: Run the tests.** Expected: PASS, including PR 0's hook tests in `init-command.test.ts`.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/cli/src/cli/ai-rules.ts packages/cli/src/cli/init-command.ts packages/cli/src/cli/__tests__/init-command.test.ts packages/cli/src/cli/__tests__/ai-rules.test.ts
  git commit -S -m "feat(init): the dry run lists every file init would touch (#159)"
  ```

---

### Task 8: Doctor checks for rules, skills and the guard hook

**Files:**
- Create: `packages/cli/src/adapters/diagnostics/checks/agent-setup-check.ts`
- Modify: `packages/cli/src/cli/ai-rules.ts` (new `readRulesStates`, `guardExpected`, `skillsExpected`)
- Modify: `packages/cli/src/cli/doctor-command.ts` (register the three checks right after `new GitHooksCheck()`)
- Test: `packages/cli/src/adapters/diagnostics/__tests__/agent-setup-check.test.ts`, `packages/cli/src/cli/__tests__/doctor-command.test.ts`

**Interfaces:**
- Consumes: `scanRulesBlocks`, `classifyRulesBlock`, `guardAndSkillsExpected`, `RULES_TEMPLATE_VERSION` (Task 1); `PLATFORMS` (Task 2); `SKILL_PLATFORMS`, `skillStates` (Task 3); `readClaudeGuardState`, `gateEnabled`, `resolveRulesTier` (Task 4).
- Produces:
  ```ts
  // ai-rules.ts
  export interface PlatformRulesState { readonly platformId: string; readonly file: string; readonly scan: RulesScan }
  export function readRulesStates(projectRoot: string): PlatformRulesState[];   // platforms whose rules file exists, PLATFORMS order
  export function guardExpected(projectRoot: string): boolean;   // CLAUDE.md's first block passes guardAndSkillsExpected, and gateEnabled
  export function skillsExpected(projectRoot: string, platformId: string): boolean;   // a ctxo skill is present for it, or its rules block passes guardAndSkillsExpected
  // agent-setup-check.ts
  export class AiRulesCheck implements IHealthCheck { readonly id = 'ai_rules'; readonly title = 'AI rules' }
  export class SkillsCheck implements IHealthCheck { readonly id = 'skills'; readonly title = 'Agent skills' }
  export class ClaudeGuardHookCheck implements IHealthCheck { readonly id = 'claude_guard_hook'; readonly title = 'Claude guard hook' }
  ```
- `ai_rules` collects one problem per finding, `<file>: <phrase>`, joined by `; `. It returns `warn` when there are problems, otherwise `pass` with a short summary such as `CLAUDE.md v0.13 compact; AGENTS.md v0.13 full` or `no ctxo rules blocks`. Fix text: `Run "ctxo doctor --fix" or "ctxo init" to re-render the ctxo rules blocks`. Phrases:
  - outdated: `rules template outdated (<unversioned|vX.Y|edited> block, template v<RULES_TEMPLATE_VERSION>)`;
  - Claude Code only, when the guard state is `absent` and `guardExpected`: `rules present, guard missing`;
  - a current block whose tier is not `resolveRulesTier(root, id)`, unless `rules present, guard missing` was already reported for that file: `rules tier does not match the guard and skills (expected <tier>)`;
  - `<n> ctxo rules blocks`;
  - `start marker without end marker`.
  - A `newer` block is not a problem.
- `skills`: for each `SKILL_PLATFORMS` id where `skillsExpected`, report `<Claude Code|Cursor>: missing <names>` and `<Claude Code|Cursor>: outdated <names>`. Fix text: `Run "ctxo doctor --fix" or "ctxo init --only skills"`.
- `claude_guard_hook`:
  - `unreadable` gives `warn` with `.claude/settings.json is not valid JSON or not a settings object; the guard cannot be verified` and the fix text `Repair .claude/settings.json by hand; ctxo never overwrites it`;
  - `absent` with `guardExpected` gives `warn` with `safe-edit guard hook missing from .claude/settings.json` and the fix text `Run "ctxo doctor --fix" or "ctxo init --only guard"`;
  - otherwise `pass` with `installed`, `installed, disabled by gate.enabled: false` or `not installed`.
- All three return only `pass` or `warn`. Any internal error, such as bundled skills not found, becomes a `warn` that carries the message, never a throw.

- [ ] **Step 1: Write the failing tests** (temp dirs, fixtures built with `renderRulesBlock`, `LEGACY_RULE_BODY` and `ensureClaudeHook`):
  - `ai_rules passes when no rules file has a ctxo block`.
  - `ai_rules reports rules present, guard missing and rules template outdated for a pre-tier CLAUDE.md` (#159 acceptance): `CLAUDE.md` = `'# P\n\n<!-- ctxo-rules-start -->\n' + LEGACY_RULE_BODY + '\n<!-- ctxo-rules-end -->\n'`, with no settings. Expect `warn`, and a message containing both phrases.
  - `ai_rules reports an older template version`: a `v0.1` marker over the current full body.
  - `ai_rules does not report a block from a newer ctxo` (Review Focus 2): `v99.0` gives `pass`.
  - `ai_rules accepts a current full block without the guard as an opt-out` (Review Focus 3): `pass`.
  - `ai_rules reports a compact block when the gate is disabled`: `rules tier does not match the guard and skills (expected full)`.
  - `ai_rules checks non-Claude rules files too`: `.windsurfrules` = `LEGACY_RULE_BODY + '\n'` gives `rules template outdated`.
  - `ai_rules reports duplicate and unterminated blocks` (Review Focus 4).
  - `skills reports missing skills for a pre-tier Claude Code setup`.
  - `skills reports an edited skill as outdated`.
  - `skills does not report CRLF copies as outdated` (Review Focus 1).
  - `skills stays quiet for a current full block without skills`.
  - `claude_guard_hook warns on unreadable settings` (Review Focus 5): `'null'`.
  - `claude_guard_hook warns when the guard is missing for a pre-tier block and passes when it is present, disabled or opted out`.
  - `doctor-command.test.ts`: `doctor registers ai_rules, skills, claude_guard_hook and git_hooks`: `run({ json: true })` in an empty temp dir gives check names that include all four.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/adapters/diagnostics src/cli/__tests__/doctor-command.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the helpers and the three checks, and register them.
- [ ] **Step 4: Run the tests.** Expected: PASS. The existing `does not exit when all checks pass or warn on healthy project` still reports zero fails.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/cli/src/adapters/diagnostics/checks/agent-setup-check.ts packages/cli/src/cli/ai-rules.ts packages/cli/src/cli/doctor-command.ts packages/cli/src/adapters/diagnostics/__tests__/agent-setup-check.test.ts packages/cli/src/cli/__tests__/doctor-command.test.ts
  git commit -S -m "feat(doctor): ai_rules, skills and claude_guard_hook checks (#159)"
  ```

---

### Task 9: `doctor --fix` remediation and the #159 doctor acceptance

**Files:**
- Modify: `packages/cli/src/cli/doctor-fix.ts` (`applyFixes`, its order comment, new fix functions)
- Test: `packages/cli/src/cli/__tests__/doctor-fix.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `classifyRulesBlock`;
  - Task 2: `installRules`;
  - Task 3: `installSkills`, `SKILL_PLATFORMS`;
  - Task 4: `ensureClaudeHook`, `readClaudeGuardState`, `resolveRulesTier`;
  - Task 8: `readRulesStates`, `guardExpected`, `skillsExpected` and the three check classes.
- Produces three attempts, after `Git hooks` and before `Language plugins` (D13), with exact names and actions:
  - `Skills` / `install missing or outdated ctxo skills`, when `skills` is not `pass`: `installSkills(root, id)` for every `SKILL_PLATFORMS` id where `skillsExpected`.
  - `Claude guard hook` / `register ctxo gate-hook in .claude/settings.json`, when `claude_guard_hook` is not `pass`:
    - `unreadable`: throw an `Error` carrying the `ensureClaudeHook` warning. The attempt fails and the run continues.
    - `absent` with `guardExpected`: call `ensureClaudeHook(root)`.
  - `AI rules` / `re-render ctxo rules blocks`, when any of `ai_rules`, `skills` or `claude_guard_hook` is not `pass`:
    - for each `readRulesStates` entry that has a block whose status is not `newer`, call `installRules(root, id, { tier: resolveRulesTier(root, id) })`;
    - after the loop, throw the joined warnings if any result carried one.

- [ ] **Step 1: Write the failing tests.**
  - `schedules Skills, Claude guard hook and AI rules after Git hooks and before Language plugins`: a `dryRun` report with `git_hooks`, `ai_rules`, `skills`, `claude_guard_hook` and `language_coverage` gives attempt names in that order.
  - `re-renders AI rules when only the skills check failed`.
  - `doctor reports rules present, guard missing and rules template outdated, and --fix resolves both (#159 acceptance)`. In a temp dir with the pre-tier `CLAUDE.md` from Task 8, with `CI` unset:
    1. Run `new HealthChecker([new AiRulesCheck(), new SkillsCheck(), new ClaudeGuardHookCheck()], { quiet: true }).runAll(ctx)`. The `ai_rules` message contains both phrases.
    2. Run `applyFixes(report, { projectRoot, ctxoRoot, yes: true })`.
    3. Re-run the checks. All three `pass`; `CLAUDE.md` has exactly one start marker and the compact body, with the text before the block intact; `.claude/settings.json` holds `ctxo gate-hook`.
  - `--fix leaves a deliberate opt-out alone` (Review Focus 3): after `InitCommand.run({ tools: ['claude-code'], yes: true, noGuard: true, noInstall: true })`, all three checks pass, `applyFixes` schedules none of the three attempts, and `.claude/settings.json` stays absent.
  - `--fix reports a corrupt settings.json as failed and leaves it unchanged`: the pre-tier `CLAUDE.md` plus `.claude/settings.json` = `'not json{{{'`. Expect `Claude guard hook` with status `failed`, the settings bytes unchanged, and `AI rules` still run with status `success` (full block, since the guard cannot be read).
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/doctor-fix.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the three fix functions and the scheduling, and update the order comment at the top of `applyFixes`.
- [ ] **Step 4: Run the tests.** Expected: PASS. Then `pnpm --filter @ctxo/cli test:unit` and `pnpm --filter @ctxo/cli lint`. Expected: all pass, lint clean.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/cli/src/cli/doctor-fix.ts packages/cli/src/cli/__tests__/doctor-fix.test.ts
  git commit -S -m "feat(doctor): --fix installs skills and the guard, then re-renders rules blocks (#159)"
  ```

---

### Task 10: ADR-015 amendment, docs, help and changeset

**Files:**
- Modify:
  - `docs/architecture/ADR/adr-015-safe-edit-guard.md`
  - `site/docs/cli/init.md`, `site/docs/cli/doctor.md`, `site/docs/cli/overview.md`
  - `site/docs/concepts/safe-edit-guard.md` (the feature doc for this PR), `site/docs/integrations/gemini-cli.md`, `site/docs/reference/config-schema.md`
  - `llms.txt`, `llms-full.txt`, `README.md`, `CLAUDE.md` (Quick Reference and the Safe-Edit Guard section only; D14)
  - `CHANGELOG.md`, `docs/roadmap.md`
  - `packages/cli/src/core/agent-rules/rules-block.ts` (`RULES_TEMPLATE_VERSION`, only if Step 4 says so)
- Create: `.changeset/tiered-agent-rules.md`

- [ ] **Step 1: Amend ADR-015.**
  - Status: `Accepted (v0.8); amended for #159 (tiered rules)`.
  - Under Hook behavior, add: "**Matcher `Edit` only**: `ctxo init` registers the hook with matcher `Edit`, and `ctxo gate-hook` ignores every other tool. `Write` (new files and whole-file rewrites) and `NotebookEdit` are not gated; `MultiEdit` no longer exists in Claude Code."
  - Replace the "Session state ... is in-process memory" trade-off with: "Session state is a file store, not process memory. `ctxo gate-hook` runs as a new process per Edit call, records the symbols it already warned about in `.ctxo/.cache/gate/<session_id>.json`, and also accepts a `get_blast_radius` call found in the session transcript. The state survives MCP server restarts; each session writes its own file, so no locking is needed."
  - Under the "Shared session state via external store" alternative, replace the rejection with: "Adopted in a minimal form: per-session JSON files under `.ctxo/.cache/gate/`. A shared SQLite store was not needed."
  - In the layer table's Rules row, add "compact for Claude Code with the guard and skills, full elsewhere".
  - Add a section `## Amendment: tiered rules (#159)` covering:
    - the compact block (at most 8 lines) for Claude Code when the guard, the skills and an enabled gate exist, and the full block elsewhere;
    - the versioned marker and the in-place replacement;
    - `--only`/`--skip`/`--no-guard`;
    - the `ai_rules`, `skills` and `claude_guard_hook` doctor checks;
    - the tool-selection guide in `ctxo-understand`.
- [ ] **Step 2: Update the docs.**
  - `site/docs/cli/init.md`:
    - a parts table (part to files);
    - flag rows for `--only`, `--skip` and `--no-guard`;
    - `--rules` marked deprecated (same as `--skip git-hooks,guard`, prints a notice);
    - `--dry-run` "lists every file init would create or change";
    - "What it writes": versioned markers, user content outside them kept, the tier rule;
    - fix "Safe-edit guard prompt": the question appears only when Claude Code is selected; `--no-guard` skips it; Cursor gets skills and the full block, but no prompt and no hook;
    - examples for `--only guard,skills --tools claude-code -y` and `--skip git-hooks`.
  - `site/docs/cli/doctor.md`: rows for AI rules, Agent skills and Claude guard hook, and the new remediation steps 3 to 5 (Skills, Claude guard hook, AI rules).
  - `site/docs/cli/overview.md`: the `init` row reads "Interactive setup: rules, skills, safe-edit guard, MCP config, git hooks, plugin install".
  - `site/docs/concepts/safe-edit-guard.md`: tiered rules in the Rules layer, the doctor checks, `--no-guard`, and the ADR link fixed from ADR-013 to `adr-015-safe-edit-guard.md`.
  - `site/docs/integrations/gemini-cli.md`: the marker text becomes `<!-- ctxo-rules-start v<version> -->` / `<!-- ctxo-rules-end -->`.
  - `site/docs/reference/config-schema.md`: `gate.enabled: false` also makes `ctxo init` write the full rules block for Claude Code.
  - `llms.txt` and `llms-full.txt`: under the newest "New in" heading (create it for the release version if PRs 0 to 1C did not), add the tiers, the new init flags and the three checks. In the llms-full Safe-Edit Guard section, add the file-store session state and the tiered rules.
  - `README.md`, Safe-Edit Guard section: the compact `CLAUDE.md` block, plus `ctxo init --skip git-hooks` and `ctxo init --only guard,skills`.
  - `CLAUDE.md`:
    - Quick Reference gains `ctxo init --only <parts>`, `ctxo init --skip <parts>`, `ctxo init --no-guard` and `ctxo init --dry-run` (lists every file);
    - the Safe-Edit Guard section gains one sentence on tiered rules and the three doctor checks.
  - `CHANGELOG.md` `[Unreleased]`, with #159:
    - Added: tiers, version marker, init parts, dry-run listing, doctor checks and fixes;
    - Changed: narrowed full wording, the `ctxo-understand` selection guide, `--rules` deprecated, create-mode files keep user content;
    - Fixed: a new `CLAUDE.md` got no markers and was duplicated on the next run, create-mode files always reported "updated", a corrupt or oddly shaped `.claude/settings.json` was overwritten or crashed init.
  - `docs/roadmap.md`: a shipped bullet "Tiered agent rules (#159)", and a Deferred row "#159 Grep hint" (source #159 item 7; trigger: gate adoption telemetry, spec section 17).
  - No em dashes: `git grep -nP "\x{2014}"` over the touched docs shows no new lines (compare with `git diff`).
- [ ] **Step 3: Write the changeset** `.changeset/tiered-agent-rules.md` with `"@ctxo/cli": minor`. The release note (two sentences, naming #159): Claude Code gets a compact ctxo block when the guard and skills are installed, other clients the full block; `ctxo init` gains `--only`, `--skip` and `--no-guard`, and `ctxo doctor` gains `ai_rules`, `skills` and `claude_guard_hook`.
- [ ] **Step 4: Confirm the template version (D1).** Run `pnpm changeset status --verbose`. If the planned `@ctxo/cli` version's `major.minor` differs from `RULES_TEMPLATE_VERSION`, set the constant to it. Tests reference the constant, so no test changes.
- [ ] **Step 5: Check the CLI help against the code.** Run `pnpm --filter @ctxo/cli build && node packages/cli/dist/index.js --help`. Expected: the seven `ctxo init` lines from Task 5.
- [ ] **Step 6: Full verification.** Run `pnpm -r build && pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm --filter @ctxo/cli test:e2e`. Expected: all green, including the tarball size test. If it crosses 1350 KB, raise the limit in this PR with the measured size and the reason (spec section 4).
- [ ] **Step 7: Commit.**
  ```bash
  git add docs/architecture/ADR/adr-015-safe-edit-guard.md site/docs/cli/init.md site/docs/cli/doctor.md site/docs/cli/overview.md site/docs/concepts/safe-edit-guard.md site/docs/integrations/gemini-cli.md site/docs/reference/config-schema.md llms.txt llms-full.txt README.md CLAUDE.md CHANGELOG.md docs/roadmap.md .changeset/tiered-agent-rules.md
  git commit -S -m "docs: ADR-015 amendment, tiered rules docs, init and doctor reference, changeset (#159)"
  ```
  Add `packages/cli/src/core/agent-rules/rules-block.ts` to the same commit only if Step 4 changed it.

---

### Task 11: Smoke runs (scratch repo and fixture clone; nothing committed)

- [ ] **Step 1:** Build: `pnpm --filter @ctxo/cli build`. Then set up a scratch repo in the session scratchpad:
  - `git init`;
  - a `CLAUDE.md` with user text, an unversioned `<!-- ctxo-rules-start -->` block holding any text, and more user text.
- [ ] **Step 2:** In the scratch repo, run `node <worktree>/packages/cli/dist/index.js doctor --json`. Expected:
  - `ai_rules` is `warn`, with both #159 phrases;
  - `skills` and `claude_guard_hook` are `warn`.
- [ ] **Step 3:** Run `node <worktree>/packages/cli/dist/index.js doctor --fix --yes`, then `doctor --json` again. Expected:
  - the three agent checks pass;
  - `CLAUDE.md` holds one block of at most 8 lines, with the user text intact and in order.
- [ ] **Step 4:** In a second fresh scratch repo:
  1. Run `init --tools claude-code,cursor --dry-run`. Expected: every file is listed.
  2. Run `init --tools claude-code --only rules,skills,guard -y`. Expected: the hooks directory is unchanged and `CLAUDE.md` gets the compact block.
- [ ] **Step 5:** Do not run `claude --debug -p` or any other nested `claude` session from here. Live hook verification inside Claude Code is left to the owner (spec section 4 asks to re-verify hook behaviour with `claude --debug`): note in the PR description draft that the guard entry is covered by the tests and the doctor check only, and that the owner runs `claude --debug` against the `.claude/settings.json` that Step 4 wrote in the second scratch repo.
- [ ] **Step 6:** In the private fixture clone (path from the owner's brief, never the original checkout), run only the read-only commands:
  - `node <worktree>/packages/cli/dist/index.js init --tools claude-code --dry-run`;
  - `node <worktree>/packages/cli/dist/index.js doctor --json`.

  Expected: no crash, and the three agent checks report. Record only pass and warn counts in the PR description draft (scratchpad). Nothing from the fixture goes into the repo.
