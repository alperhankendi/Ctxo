---
"@ctxo/cli": minor
---

Claude Code now gets a compact ctxo block in `CLAUDE.md` when the safe-edit guard and the skills are installed, and every other client gets the full block, inside versioned markers that are replaced in place without touching the rest of the file (#159). `ctxo init` gains `--only`, `--skip` and `--no-guard`, and `ctxo doctor` gains the `ai_rules`, `skills` and `claude_guard_hook` checks, which `ctxo doctor --fix` repairs. The blocks and skills are formatter-stable, a rules file linked to another client's gets the full block, skills carry a version marker so an older ctxo leaves a newer skill alone, and a block that expects the guard and the skills is left unchanged until they are installed. Upgrade a team together: a ctxo from before this release does not read the versioned markers.
