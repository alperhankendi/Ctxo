---
name: ctxo-safe-edit
description: Use BEFORE editing, renaming, or deleting any function, class, or method, to avoid breaking dependents.
---

# Safe edit with ctxo

Before changing a symbol, in order - do NOT skip:

1. `get_blast_radius(symbolId)` - see what breaks. If confirmed/likely dependents exist, plan to update them too.
2. `get_why_context(symbolId)` - check for revert history or anti-patterns. If found, STOP and tell the user instead of repeating a reverted approach.
3. Only then edit the source.
4. After editing, re-check the dependents from step 1.

A deterministic guard may block the first edit of a high-impact symbol until you have run get_blast_radius. That is expected - run it, then re-issue the edit.
