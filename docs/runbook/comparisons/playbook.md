# Comparison playbook: ctxo vs without ctxo

How the comparison pages in `site/docs/comparisons/` are produced. Every page answers one question: same task, same model, same code base. Does an agent with ctxo do better than an agent working the file system by hand?

## Ground rules

- **One variable.** Both sessions get the same prompt, model, effort and repository state. The without session gets one extra line: "Do NOT use ctxo: no ctxo CLI command and no ctxo MCP tool."
- **Same knowledge on both sides.** Anything that is plain text in the repository (docs, domain cards, ADRs) is present in both copies. The variable is how ctxo brings it to the agent, not whether it exists.
- **Real code base, published under pseudonyms.**
  - A run may use a private production repository, but only through a throwaway clone, never the original checkout.
  - Before anything is published, every class, file, namespace, table, context and rule name is renamed or made generic. The pseudonym map stays private.
  - Project-size figures are rounded at most (for example "~3,500 indexed symbols").
- **Ground truth comes from outside ctxo.** It is the compiler, a scripted scan, an agent that may not use ctxo and must cite a file and line for every claim, or applying the change on a throwaway branch. It is never ctxo's own output.
- **Repeat, then report.** At least 3 runs per cell (setup x effort level). One run can show a 20% difference that a second run does not reproduce.
- **Publish measured numbers only,** including the cells where ctxo is on par or behind. Keep the existing pages; every page names the model and effort it ran with.

## Setup

1. **Two copies.** Make two fresh copies of the repository with `git clone --no-hardlinks`, named `with` and `without`. Bring in the remote-tracking branches of the source clone, so branch names count as evidence on both sides. Restore the build in both copies (for example `dotnet restore <solution>` for a .NET repository). Without a restore, the Roslyn tier cannot resolve package types, and every SQL call site through Dapper or `SqlCommand` goes unrecognized.
2. **Strip ctxo from the `without` copy.** Remove every ctxo artifact: the ctxo MCP entry, ctxo hooks, `.claude/skills/ctxo-*`, the ctxo rules block in `CLAUDE.md` and `.ctxo/`. Leave these as uncommitted changes, so the git history stays identical.
3. **Prepare the `with` copy the way a user would.** Run `ctxo init` (with `--domain` when the page is about the domain layer), then `ctxo index`. If a setup step already writes the answer the task asks for (for example a discovered config), reset that value, so the session still has to find it.
4. **Isolate each session.**
   - Give it a fresh, empty `CLAUDE_CONFIG_DIR` that holds only a copy of the sign-in credentials. Nothing from the operator's user config, memory, plugins or skills is loaded. Delete the directory after the run.
   - Pass `--setting-sources user,project`. The repository's own `CLAUDE.md`, `.claude/skills` and `.claude/settings.json` load on both sides, as for a real user; on the `with` side they include what `ctxo init` wrote. With `user` alone none of them load, so the `with` session never sees the ctxo rules and skills.
   - Pass `--no-session-persistence` and `--strict-mcp-config`. Only the `with` session gets `--mcp-config` with ctxo.
   - Allow read-only tools only (`Bash Read Grep Glob Agent Task`, plus `mcp__ctxo` on the `with` side), and disallow `Edit`, `Write` and `NotebookEdit`. A change task asks for the diff in the chat.
   - Check the first `system/init` event of a smoke run, and ask the smoke session whether it sees the project's `CLAUDE.md` and skills.
5. **Run.** Use `claude -p "<prompt>" --model <model> --effort <level> --output-format stream-json --verbose`, and keep the full stream as the transcript. Run the cells of one round at the same time, so machine load is the same for both sides. Do not edit the run script while runs use it.

## Scoring

**Acceptance list, frozen before the first run.**
- Write the expected result as weighted items, each with a "covered when" condition and the evidence for it.
- Score each item Covered (1), Partial (0.5) or Missing (0). Case score = 100 x sum(weight x score) / sum(weight). Weights reflect importance and verifiability, not code volume.
- Name borderline items in advance and leave them out of the score.

**Blind judge.** An agent that may not use ctxo scores every answer against the list, checking claims against the code. It sees each answer under a neutral id, with ctxo and tool names removed. The id map stays private until scoring is done.

**Negative controls.** Mix control answers into the judge's set and check that they land where expected before trusting the scores:
- an empty answer: about 0;
- the trap answer (the plausible wrong solution): low;
- an answer that names the right places with no real logic: low;
- an answer written from the acceptance list: about 100.

**Report.**
- Accuracy per run, both "found in at least one run" and "found in every run".
- Mean and standard error for wall-clock time, cost, output tokens and tool calls.
- How often the `with` side actually called ctxo, per run.

## Lessons so far

- **A single run misleads.** The table split page first reported, from one run per cell, that ctxo was 20% faster and 12% cheaper at xhigh. Over three runs per cell the time and cost differences were within noise; the stable difference was fewer output tokens with ctxo. The page now shows the three-run numbers.
- **A task that does not discriminate.** A business-rule change ("which users take a license seat") gave full marks to every run on both sides. The rule was stated in a doc comment next to the code and in the project's `CLAUDE.md`, so the agent found it without the domain layer. To measure the domain layer, pick a rule that the code near the change does not state.
- **Check the agent saw the setup.** One early round ran without the project's `CLAUDE.md` and skills (`--setting-sources user`); the `with` session then made no ctxo calls at all.

## Page format

Copy the structure of `site/docs/comparisons/safe-refactor.md`:

1. **Use Case:** the real question an engineer asks.
2. **The Change:** the task, the tier, the size (rounded), the model and the effort.
3. **Two Approaches:** the tool chain with ctxo, and what the without session had to do.
4. **Live Comparison:** both terminals side by side, condensed from the transcripts.
5. **Head to Head:** mean and standard error per cell, accuracy per run, and how the ground truth was produced.
6. **What Actually Differed:** the honest takeaways, including where ctxo missed something or made no difference.
7. **Method:** a link to this playbook.
