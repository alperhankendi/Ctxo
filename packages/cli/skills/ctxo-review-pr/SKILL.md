---
name: ctxo-review-pr
description: Use when reviewing a PR, a diff, or recent changes, to get a full risk assessment in one call.
---

# Review a PR with ctxo

1. `get_pr_impact` — single call: changed symbols + blast radius + co-change risk.
2. For any high-risk symbol it surfaces, follow up with `get_why_context`.
3. Summarize risk for the human: what breaks, what needs extra review, what has a bad history.
