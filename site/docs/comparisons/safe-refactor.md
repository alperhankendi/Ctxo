---
layout: false
title: Changing a Core Dependency - ctxo vs Coding Blind
---

<style>
:root {
    --bg: #f8fafc;
    --white: #ffffff;
    --text: #0f172a;
    --text-secondary: #64748b;
    --text-light: #94a3b8;
    --accent: #0d9488;
    --accent-light: #14b8a6;
    --accent-bg: #f0fdfa;
    --accent-border: #99f6e4;
    --accent-gradient: linear-gradient(135deg, #14b8a6, #0284c7);
    --orange: #ea580c;
    --orange-bg: #fff7ed;
    --red: #dc2626;
    --red-bg: #fef2f2;
    --info: #0284c7;
    --border: #e2e8f0;
    --border-light: #f1f5f9;
    --shadow-sm: 0 2px 8px rgba(0,0,0,0.04);
    --shadow: 0 4px 16px rgba(0,0,0,0.06);
    --shadow-lg: 0 8px 32px rgba(0,0,0,0.08);
    --radius: 16px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 1100px; margin: 0 auto; padding: 0 32px; }
  .hero {
    text-align: center;
    padding: 100px 32px 80px;
    background: linear-gradient(180deg, #ffffff 0%, var(--bg) 100%);
  }
  .hero-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--accent-bg);
    color: var(--accent);
    padding: 6px 14px;
    border-radius: 100px;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 24px;
  }
  .hero h1 {
    font-size: 48px;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.03em;
    line-height: 1.15;
    margin-bottom: 16px;
  }
  .hero h1 em {
    font-style: normal;
    background: var(--accent-gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .hero p { font-size: 18px; color: var(--text-secondary); max-width: 560px; margin: 0 auto; }
  .section { margin-bottom: 80px; }
  .section-eyebrow {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    font-weight: 600;
    margin-bottom: 8px;
  }
  .section-title { font-size: 32px; font-weight: 700; color: var(--text); letter-spacing: -0.02em; margin-bottom: 12px; }
  .section-desc { color: var(--text-secondary); font-size: 16px; max-width: 640px; margin-bottom: 40px; }
  .task-card {
    background: var(--white);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 48px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 48px;
  }
  .task-card h3 { font-size: 16px; font-weight: 600; color: var(--text); margin-bottom: 12px; }
  .task-card p { font-size: 14px; color: var(--text-secondary); line-height: 1.7; }
  .tag {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    margin-right: 4px;
    margin-bottom: 8px;
  }
  .tag-lang { background: var(--accent-bg); color: var(--accent); }
  .tag-symbols { background: #f0f9ff; color: var(--info); }
  .tag-model { background: #f5f3ff; color: #7c3aed; }
  .comp-table-wrap {
    background: var(--white);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .comp-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .comp-table thead { background: var(--bg); }
  .comp-table th {
    text-align: left;
    padding: 14px 24px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-light);
    font-weight: 600;
    border-bottom: 1px solid var(--border);
  }
  .comp-table th.col-ctxo { color: var(--accent); }
  .comp-table th.col-manual { color: var(--orange); }
  .comp-table td { padding: 14px 24px; border-bottom: 1px solid var(--border-light); color: var(--text); vertical-align: top; }
  .comp-table tr:last-child td { border-bottom: none; }
  .comp-table td:first-child { color: var(--text-secondary); font-weight: 500; }
  .comp-table .win { color: var(--accent); font-weight: 600; }
  .comp-table .bad { color: var(--red); font-weight: 600; }
  .quality-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .quality-card {
    background: var(--white);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 32px;
  }
  .quality-card h4 { font-size: 15px; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .dot-ctxo { background: var(--accent); }
  .dot-manual { background: var(--orange); }
  .quality-list { list-style: none; font-size: 14px; }
  .quality-list li {
    padding: 7px 0;
    color: var(--text-secondary);
    display: flex;
    align-items: flex-start;
    gap: 10px;
    line-height: 1.5;
  }
  .quality-list li::before {
    content: '';
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #d1d5db;
    margin-top: 8px;
    flex-shrink: 0;
  }
  .verdict-card {
    background: var(--white);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 36px;
    margin-top: 24px;
    border-left: 4px solid var(--accent);
  }
  .verdict-card h4 { font-size: 16px; font-weight: 700; color: var(--text); margin-bottom: 12px; }
  .verdict-card p { font-size: 14px; color: var(--text-secondary); line-height: 1.8; }
  .pillars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 24px; }
  .pillar { background: var(--accent-bg); border: 1px solid var(--accent-border); border-radius: 12px; padding: 18px; }
  .pillar h5 { font-size: 13px; font-weight: 700; color: var(--accent); margin-bottom: 6px; }
  .pillar p { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }
  .terminal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .terminal {
    background: #0d1117;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: var(--shadow-lg);
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    display: flex;
    flex-direction: column;
    border: 1px solid #21262d;
  }
  .term-bar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #161b22; border-bottom: 1px solid #21262d; }
  .term-dots { display: flex; gap: 6px; }
  .term-dots span { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
  .d-r { background: #ff5f56; } .d-y { background: #ffbd2e; } .d-g { background: #27c93f; }
  .term-title { color: #8b949e; font-size: 12px; margin-left: 6px; font-weight: 600; }
  .term-title .label-ctxo { color: #2dd4bf; }
  .term-title .label-manual { color: #fb923c; }
  .term-elapsed { margin-left: auto; color: #6e7681; font-size: 11px; }
  .term-body { padding: 16px; overflow-y: auto; flex: 1; color: #c9d1d9; line-height: 1.7; max-height: 660px; margin: 0; }
  .term-body .ln { display: block; }
  .term-body .i { padding-left: 1.4em; }
  .p { color: #58a6ff; }
  .cmd { color: #d2a8ff; }
  .out { color: #8b949e; }
  .ok { color: #3fb950; }
  .warn { color: #d29922; }
  .err { color: #f85149; }
  .dim { color: #6e7681; }
  .hl { color: #e6edf3; font-weight: 600; }
  .star { color: #f0d264; font-weight: 600; }
  .term-foot { padding: 10px 14px; border-top: 1px solid #21262d; background: #161b22; color: #8b949e; font-size: 11px; display: flex; gap: 16px; flex-wrap: wrap; }
  .term-foot b { color: #c9d1d9; }
  .page-footer { text-align: center; padding: 60px 32px; border-top: 1px solid var(--border); margin-top: 40px; }
  .page-footer p { color: var(--text-light); font-size: 14px; margin-bottom: 8px; }
  .page-footer .brand { font-weight: 700; background: var(--accent-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .page-footer .tagline { font-size: 13px; color: var(--text-light); font-style: italic; max-width: 520px; margin: 8px auto 0; }
  .note { font-size: 12.5px; color: var(--text-light); max-width: 760px; margin: 18px auto 0; text-align: center; line-height: 1.7; }
  @media (max-width: 900px) {
    .task-card, .quality-grid, .terminal-grid, .pillars { grid-template-columns: 1fr; }
    .term-body { max-height: none; }
  }
</style>

<nav style="position:fixed;top:0;right:0;z-index:100;display:flex;gap:0.25rem;padding:1rem 1.5rem;">
  <a href="/Ctxo/" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.4rem 0.75rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:700;color:#0d9488;border:1px solid rgba(13,148,136,0.25);border-radius:6px;background:rgba(13,148,136,0.04);text-decoration:none;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Ctxo</a>
  <a href="/Ctxo/ctxo-visualizer.html" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.4rem 0.75rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:700;color:#0284c7;border:1px solid rgba(2,132,199,0.22);border-radius:6px;background:rgba(2,132,199,0.07);text-decoration:none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/><path d="M2 12h20"/></svg> Visualizer</a>
  <a href="https://github.com/alperhankendi/Ctxo" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.4rem 0.75rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:700;color:#64748b;border:1px solid #e2e8f0;border-radius:6px;background:#ffffff;text-decoration:none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg> Source</a>
</nav>

<section class="hero">
  <div class="hero-badge">Real Refactor / Opus 4.8</div>
  <h1>Changing a core dependency<br>ctxo vs <em>coding blind</em></h1>
  <p>Add one mandatory parameter to the most-used method in a production backend. Both runs find what breaks. Only one of them stays reliable getting there.</p>
</section>

<div class="container">
  <section class="section">
    <div class="section-eyebrow">The Use Case</div>
    <div class="section-title">"Add a required CancellationToken to our connection factory"</div>
    <div class="section-desc">A real refactor on a production C# backend (clean architecture, ~3,500 indexed symbols). <code style="color:var(--accent);font-size:13px;">IConnectionFactory.CreateConnectionAsync()</code> is the database access primitive: almost every repository, sync service, API endpoint and background job calls it. Making the parameter mandatory ripples through the whole codebase. The question every engineer asks first: <strong>what exactly breaks?</strong></div>
    <div class="task-card">
      <div>
        <h3>The Change</h3>
        <p><span class="tag tag-lang">C# / Roslyn tier</span> <span class="tag tag-symbols">~3,500 symbols</span> <span class="tag tag-model">Claude Opus 4.8</span></p>
        <p style="margin-top: 12px;">Add a non-optional <code style="font-size:13px;">CancellationToken</code> to the interface method and its single implementation. Every call site that omits it stops compiling. The same prompt, the same model, the same codebase. The only variable: does the agent have ctxo, or does it work the file system by hand?</p>
      </div>
      <div>
        <h3>Two Approaches</h3>
        <p><strong style="color: var(--accent);">With ctxo:</strong> one deterministic tool chain - <code style="color:#7c3aed;font-size:13px;">search_symbols</code>, <code style="color:#7c3aed;font-size:13px;">get_symbol_importance</code>, <code style="color:#7c3aed;font-size:13px;">find_importers</code>, <code style="color:#7c3aed;font-size:13px;">get_blast_radius</code>, <code style="color:#7c3aed;font-size:13px;">get_why_context</code>.</p>
        <p style="margin-top: 12px;"><strong style="color: var(--orange);">Without ctxo:</strong> grep, ripgrep, file reads, and parallel sub-agents - many rounds, manual reconciliation, no graph to lean on.</p>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="section-eyebrow">Live Comparison</div>
    <div class="section-title">Side by side, in the terminal</div>
    <div class="section-desc">Two Claude Code sessions, same task. Left leans on ctxo's dependency graph. Right is told not to use it.</div>
    <div class="terminal-grid">
      <div class="terminal">
        <div class="term-bar">
          <div class="term-dots"><span class="d-r"></span><span class="d-y"></span><span class="d-g"></span></div>
          <span class="term-title">claude - <span class="label-ctxo">with ctxo</span></span>
          <span class="term-elapsed">one pass</span>
        </div>
        <div class="term-body">
          <div class="ln p">› what breaks if I make CancellationToken required on IConnectionFactory.CreateConnectionAsync?</div>
          <div class="ln cmd" style="margin-top:8px;">→ ctxo search_symbols "CreateConnectionAsync"</div>
          <div class="ln out i">IConnectionFactory.CreateConnectionAsync (method) · 1 impl</div>
          <div class="ln cmd">→ ctxo get_symbol_importance</div>
          <div class="ln star i">★ PageRank #1 of 3,583 symbols (inDegree 140)</div>
          <div class="ln cmd">→ ctxo get_class_hierarchy</div>
          <div class="ln out i">descendants: 1 (ConnectionFactory) · no hidden impls</div>
          <div class="ln cmd">→ ctxo find_importers</div>
          <div class="ln out i">140 callers · <span class="hl">155 call sites</span> · <span class="hl">54 files</span></div>
          <div class="ln cmd">→ ctxo get_blast_radius</div>
          <div class="ln out i">impactScore 260 · risk <span class="hl">1.0</span> · <span class="warn">18 clusters</span></div>
          <div class="ln warn i">"Change impacts 18 clusters - multi-team review recommended"</div>
          <div class="ln cmd">→ ctxo get_why_context</div>
          <div class="ln out i">no reverts · no anti-patterns · snapshot current</div>
          <div class="ln ok" style="margin-top:10px;">✓ Full impact map in one chain.</div>
          <div class="ln out i">The single most central symbol in the codebase. 155 sites across 54 files will not compile - API, sync, crypto, reports.</div>
        </div>
        <div class="term-foot"><span><b>6</b> tool calls</span><span><b>0</b> sub-agents</span><span><b>0</b> retries</span><span>deterministic</span></div>
      </div>
      <div class="terminal">
        <div class="term-bar">
          <div class="term-dots"><span class="d-r"></span><span class="d-y"></span><span class="d-g"></span></div>
          <span class="term-title">claude - <span class="label-manual">without ctxo</span></span>
          <span class="term-elapsed">many rounds</span>
        </div>
        <div class="term-body">
          <div class="ln p">› what breaks if I make CancellationToken required? (do NOT use ctxo)</div>
          <div class="ln cmd" style="margin-top:8px;">$ grep "CreateConnectionAsync" (built-in)</div>
          <div class="ln err i">→ only IConnectionFactory.cs · 1 match?!</div>
          <div class="ln err i">is this abstraction even used? looks like dead code...</div>
          <div class="ln cmd" style="margin-top:8px;">$ rg "\.CreateConnectionAsync\(" (raw ripgrep, retry)</div>
          <div class="ln warn i">155 matches / 54 files - built-in tool had misfired</div>
          <div class="ln cmd" style="margin-top:8px;">⇉ dispatch 2x Explore sub-agents</div>
          <div class="ln out i">agent A: 70 · agent B: 63 · counts disagree</div>
          <div class="ln dim i">re-verify every line by hand (sub-agents not trusted)</div>
          <div class="ln cmd" style="margin-top:8px;">$ rg ... ×10 more rounds + read ×4</div>
          <div class="ln dim i">reconcile, dedup, cross-check each claimed call site</div>
          <div class="ln ok" style="margin-top:10px;">✓ Same answer - eventually: 155 sites / 54 files</div>
          <div class="ln dim i">no centrality. no history. no risk score.</div>
          <div class="ln dim i">nearly mislabeled the #1 symbol as unused.</div>
        </div>
        <div class="term-foot"><span><b>~15</b> tool calls</span><span><b>2</b> sub-agents</span><span class="warn"><b>grep misfired</b></span><span>varies per run</span></div>
      </div>
    </div>
    <p class="note">Tool-call and sub-agent counts are exact (read off the transcripts). Wall-clock was not stopwatched, so we describe it directionally: ctxo runs as a single fast pass; the manual route needs many sequential rounds plus parallel sub-agent dispatch.</p>
  </section>
  <section class="section">
    <div class="section-eyebrow">Head to Head</div>
    <div class="section-title">Same destination, measured</div>
    <div class="section-desc">Both reach the correct set of breakages. The difference is the path, the reliability, and what each one can even see.</div>
    <div class="comp-table-wrap">
      <table class="comp-table">
        <thead>
          <tr><th>Metric</th><th class="col-ctxo">With ctxo</th><th class="col-manual">Without ctxo</th></tr>
        </thead>
        <tbody>
          <tr><td>Tool calls to the answer</td><td class="win">6 (one chain)</td><td>~15 + 2 sub-agents</td></tr>
          <tr><td>First-pass result</td><td class="win">correct</td><td class="bad">grep misfired - 1 match, "looks like dead code"</td></tr>
          <tr><td>Centrality of the symbol</td><td class="win">PageRank #1 of 3,500, instantly</td><td class="bad">not computable by grep</td></tr>
          <tr><td>Call sites found</td><td>155 / 54 files</td><td>155 / 54 files (after recovery)</td></tr>
          <tr><td>Vs compiler ground truth</td><td class="win">155 = 154 build errors + 1 in a skipped test project. Exact.</td><td>same set, reached the expensive way</td></tr>
          <tr><td>Cross-cutting signal</td><td class="win">18 clusters - multi-team review</td><td class="bad">flat list, no boundary view</td></tr>
          <tr><td>Git history / anti-patterns</td><td class="win">checked in one call (clean)</td><td class="bad">not checked</td></tr>
          <tr><td>Reproducibility</td><td class="win">identical every run</td><td class="bad">depends on tool + sub-agent luck</td></tr>
        </tbody>
      </table>
    </div>
    <p class="note">Ground truth was produced by actually applying the change on a throwaway branch and running <code>dotnet build</code>. The compiler reported 154 missing-argument errors plus 14 downstream type-inference cascades; the one remaining predicted site lived in a test project that was skipped once the core project failed to compile. ctxo's prediction matched the compiler exactly.</p>
  </section>
  <section class="section">
    <div class="section-eyebrow">What Actually Differed</div>
    <div class="section-title">Reliability, not recall</div>
    <div class="section-desc">A strong model can grep its way to the right list. The question is what it costs, what it misses on the way, and whether you can trust the run.</div>
    <div class="quality-grid">
      <div class="quality-card">
        <h4><span class="dot dot-ctxo"></span> With ctxo</h4>
        <ul class="quality-list">
          <li>One deterministic chain returns the full reverse-dependency graph</li>
          <li>Names the single most central symbol in the codebase (PageRank #1)</li>
          <li>Symbol-scoped: counts only real callers, never text collisions</li>
          <li>Surfaces 18 affected clusters and a multi-team review signal</li>
          <li>Reads git intent and anti-pattern history in the same pass</li>
          <li>Returns indexed facts - nothing to hallucinate</li>
        </ul>
      </div>
      <div class="quality-card">
        <h4><span class="dot dot-manual"></span> Without ctxo</h4>
        <ul class="quality-list">
          <li>The built-in grep misfired and returned a single match</li>
          <li>The agent nearly concluded a critical primitive was dead code</li>
          <li>Recovery needed raw ripgrep plus two parallel sub-agents</li>
          <li>Sub-agent counts disagreed (70 vs 63) and had to be re-verified by hand</li>
          <li>No centrality, no cluster view, no history - just a flat list</li>
          <li>In a sister run, manual reasoning fabricated call sites that had to be grepped away</li>
        </ul>
      </div>
    </div>
    <div class="verdict-card">
      <h4>Verdict: same answer, different reliability</h4>
      <p>At Opus 4.8 the manual route eventually arrives at the correct set. That is the honest result, and it is exactly why the difference matters: getting there meant a misfired grep that almost flagged the codebase's most-used method as <em>unused</em>, two sub-agents whose answers disagreed, and a stack of rounds reconciling it all by hand. ctxo returned the same set as one deterministic chain, named it the #1 symbol by PageRank, mapped 18 clusters, and checked the git history - with nothing to fabricate.</p>
      <div class="pillars">
        <div class="pillar">
          <h5>Reliable</h5>
          <p>Indexed facts, symbol-scoped, identical every run. No misfires, no fabricated call sites.</p>
        </div>
        <div class="pillar">
          <h5>Sees the invisible</h5>
          <p>PageRank centrality, cluster blast radius and git intent - signals grep structurally cannot produce.</p>
        </div>
        <div class="pillar">
          <h5>Proven</h5>
          <p>Its prediction matched the compiler exactly, and it has caught real bugs in real production history.</p>
        </div>
      </div>
    </div>
  </section>
</div>

<footer class="page-footer">
  <p>Built with <span class="brand">ctxo</span></p>
  <p class="tagline">AI agents don't fail because they can't code. They fail because they code blind. Ctxo gives them the full picture before they write a single line.</p>
</footer>
