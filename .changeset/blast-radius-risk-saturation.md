---
"@ctxo/cli": patch
---

fix(blast-radius): `overallRiskScore` no longer saturates at 1.0

The previous formula divided the depth-weighted risk sum by the number of direct dependents. Since every direct dependent contributes exactly 1.0, the result was always >= 1 and got capped, so the score was effectively binary (0 or 1). `get_pr_impact` therefore reported `riskLevel: "high"` for any changed symbol with at least one dependent and the `medium` band was unreachable.

The score is now `sum(riskScore) / (sum(riskScore) + 5)`: one direct dependent scores 0.167, three 0.375 (medium, matching the balanced gate floor), twelve 0.706 (high). Heavily-depended-on symbols stay distinguishable instead of all pinning at 1.0, and wide blast still outranks deep blast.

**Behaviour change:** the bands (`low` < 0.3, `medium` 0.3 to 0.7, `high` > 0.7) are unchanged, but the scale under them is not. `get_pr_impact` now reports `high` much less often (it needs about 12 or more direct dependents, or the equivalent depth-weighted mass, where it used to fire for any symbol with one), and CI scripts that threshold `overallRiskScore` (for example `> 0.75` on `ctxo blast-radius` output) will pass where they used to fail. Review such thresholds; the docs list rough anchors for each band.
