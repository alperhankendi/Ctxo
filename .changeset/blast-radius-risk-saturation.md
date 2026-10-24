---
"@ctxo/cli": patch
---

fix(blast-radius): `overallRiskScore` no longer saturates at 1.0

The previous formula divided the depth-weighted risk sum by the number of direct dependents. Since every direct dependent contributes exactly 1.0, the result was always >= 1 and got capped, so the score was effectively binary (0 or 1). `get_pr_impact` therefore reported `riskLevel: "high"` for any changed symbol with at least one dependent and the `medium` band was unreachable.

The score is now `sum(riskScore) / (sum(riskScore) + 5)`: one direct dependent scores 0.167, three 0.375 (medium, matching the balanced gate floor), twelve 0.706 (high). Heavily-depended-on symbols stay distinguishable instead of all pinning at 1.0, and wide blast still outranks deep blast.
