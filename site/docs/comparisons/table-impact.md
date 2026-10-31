---
layout: false
title: Splitting a Core Table - ctxo vs Coding Blind
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
  <div class="hero-badge">Real Impact Analysis / Opus 5.5</div>
  <h1>Splitting a core table<br>ctxo vs <em>coding blind</em></h1>
  <p>Find every part of a running production backend that reaches one database table, directly or through layers of services and stored procedures. Both sessions get it right. Over three runs per setting, the one with ctxo writes fewer output tokens; time and cost stay within run-to-run noise.</p>
</section>

<div class="container">
  <section class="section">
    <div class="section-eyebrow">The Use Case</div>
    <div class="section-title">"Which parts of the system reach the users table?"</div>
    <div class="section-desc">A real question on a production C# and T-SQL backend (clean architecture, about 3,500 indexed symbols, a few hundred SQL scripts). The team plans to move some columns of the users table into a new table. Before anyone touches the schema, they need every entry point that can reach the table: HTTP endpoints, background jobs, CLI commands and anything that runs on every request, each with the chain down to the code or stored procedure that touches it.</div>
    <div class="task-card">
      <div>
        <h3>The Question</h3>
        <p><span class="tag tag-lang">C# / Roslyn + T-SQL</span> <span class="tag tag-symbols">~3,500 symbols</span> <span class="tag tag-model">Claude Opus 5.5</span></p>
        <p style="margin-top: 12px;">The direct access is easy: a text search finds the queries that name the table. The hard part is the reach: which endpoints and jobs end up there through interfaces, dependency injection, schedulers and procedures that call other procedures. Same prompt, same model, same repository, read-only. The only variable: has the repository been set up with <code style="font-size:13px;">ctxo init</code>, or not?</p>
      </div>
      <div>
        <h3>Two Setups</h3>
        <p><strong style="color: var(--accent);">With ctxo:</strong> the rules block and skills that <code style="font-size:13px;">ctxo init</code> writes, plus the ctxo MCP server with the index, including the data edges between C# code, procedures and tables.</p>
        <p style="margin-top: 12px;"><strong style="color: var(--orange);">Without ctxo:</strong> the same repository with every ctxo artifact removed, and the session told not to use ctxo. Grep, file reads and shell scripts.</p>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="section-eyebrow">Live Comparison</div>
    <div class="section-title">Side by side, at xhigh effort</div>
    <div class="section-desc">Two isolated Claude Code sessions: an empty config directory, no memory, no session history. Both load the repository's own CLAUDE.md and skills, as a real user's session would. This is the first of three runs per side at xhigh; the table below has all of them.</div>
    <div class="terminal-grid">
      <div class="terminal">
        <div class="term-bar">
          <div class="term-dots"><span class="d-r"></span><span class="d-y"></span><span class="d-g"></span></div>
          <span class="term-title">claude - <span class="label-ctxo">with ctxo</span></span>
          <span class="term-elapsed">518 s</span>
        </div>
        <div class="term-body">
          <div class="ln p">› which entry points reach the users table, and through which chain?</div>
          <div class="ln cmd" style="margin-top:8px;">→ skill ctxo-understand</div>
          <div class="ln cmd">→ ctxo search_symbols kind=table</div>
          <div class="ln out i">the users table as one canonical symbol</div>
          <div class="ln cmd">→ ctxo find_importers ×3 (reads, writes, executes)</div>
          <div class="ln out i">the C# methods and procedures that touch it</div>
          <div class="ln cmd">→ ctxo get_blast_radius confidence=confirmed</div>
          <div class="ln out i"><span class="hl">160</span> confirmed dependents · <span class="hl">51</span> direct</div>
          <div class="ln warn i">response limit: 21 of 160 shown, the rest traced by hand</div>
          <div class="ln cmd" style="margin-top:8px;">$ grep / read to verify each chain</div>
          <div class="ln warn i">2 queries built from strings are not in the index - found by grep</div>
          <div class="ln ok" style="margin-top:10px;">✓ 36 of 36 entry points, every chain read or write</div>
        </div>
        <div class="term-foot"><span><b>5</b> ctxo calls</span><span><b>105</b> tool calls</span><span><b>53,108</b> output tokens</span><span><b>$5.64</b></span></div>
      </div>
      <div class="terminal">
        <div class="term-bar">
          <div class="term-dots"><span class="d-r"></span><span class="d-y"></span><span class="d-g"></span></div>
          <span class="term-title">claude - <span class="label-manual">without ctxo</span></span>
          <span class="term-elapsed">650 s</span>
        </div>
        <div class="term-body">
          <div class="ln p">› which entry points reach the users table? (do NOT use ctxo)</div>
          <div class="ln cmd" style="margin-top:8px;">$ grep the SQL and C# for the table name</div>
          <div class="ln out i">the direct readers and writers</div>
          <div class="ln cmd">$ shell scripts ×73 to walk the callers</div>
          <div class="ln dim i">interfaces → implementations → DI → schedulers → routes</div>
          <div class="ln cmd">$ read ×9 to confirm the chains</div>
          <div class="ln dim i">procedure → procedure → repository → job, by hand</div>
          <div class="ln ok" style="margin-top:10px;">✓ 36 of 36 entry points, every chain read or write</div>
        </div>
        <div class="term-foot"><span><b>0</b> ctxo calls</span><span><b>84</b> tool calls</span><span><b>61,579</b> output tokens</span><span><b>$6.38</b></span></div>
      </div>
    </div>
    <p class="note">Tool calls, output tokens, wall-clock time and cost are read off the stream-json transcripts and the session result records. The terminal lines are condensed from those transcripts.</p>
  </section>
  <section class="section">
    <div class="section-eyebrow">Head to Head</div>
    <div class="section-title">Same answer, three runs per setting</div>
    <div class="section-desc">Every cell was run three times. Accuracy is the same on both sides. The one difference that holds across runs is output tokens; time and cost move more between runs of the same setting than between the two settings.</div>
    <div class="comp-table-wrap">
      <table class="comp-table">
        <thead>
          <tr><th>Metric (mean ± standard error, 3 runs)</th><th class="col-ctxo">With ctxo</th><th class="col-manual">Without ctxo</th><th>Difference</th></tr>
        </thead>
        <tbody>
          <tr><td>Entry points found per run (xhigh)</td><td>36, 36, 36</td><td>36, 36, 36</td><td>same</td></tr>
          <tr><td>Wall-clock (xhigh)</td><td>584 ± 50 s</td><td>632 ± 18 s</td><td>8% faster, within noise</td></tr>
          <tr><td>Cost (xhigh)</td><td>$5.75 ± 0.37</td><td>$5.46 ± 0.46</td><td>5% more, within noise</td></tr>
          <tr><td>Output tokens (xhigh)</td><td class="win">51,765 ± 1,791</td><td>55,554 ± 3,057</td><td class="win">7% fewer</td></tr>
          <tr><td>Tool calls (xhigh)</td><td>101 ± 6</td><td>77 ± 4</td><td>more calls</td></tr>
          <tr><td>Entry points found per run (medium)</td><td>36, 36, 35</td><td>36, 36, 35</td><td>same</td></tr>
          <tr><td>Wall-clock (medium)</td><td>294 ± 42 s</td><td>337 ± 27 s</td><td>13% faster, within noise</td></tr>
          <tr><td>Cost (medium)</td><td>$2.44 ± 0.38</td><td>$2.91 ± 0.22</td><td>16% less, within noise</td></tr>
          <tr><td>Output tokens (medium)</td><td class="win">22,328 ± 2,373</td><td>27,090 ± 896</td><td class="win">18% fewer</td></tr>
          <tr><td>Tool calls (medium)</td><td>51 ± 5</td><td>59 ± 6</td><td>14% fewer</td></tr>
        </tbody>
      </table>
    </div>
    <p class="note">Ground truth was built separately by an agent that did not use ctxo and had to cite a file and line for every hop of every chain: 36 entry points (25 HTTP endpoints, 10 background jobs and hosted services, 1 CLI command, nothing per request). Six borderline items (routes that only queue a job, a migration command that changes the schema, the host command that starts everything) were left out of the score, and every session explained how it treated them. At medium, each side missed one different endpoint in one of its three runs. The ctxo session made 5, 3 and 0 ctxo calls in its three medium runs and 5, 5 and 6 at xhigh. An earlier version of this page reported one run per cell (ctxo 20% faster and 12% cheaper at xhigh); the second and third runs did not reproduce that.</p>
  </section>
  <section class="section">
    <div class="section-eyebrow">What Actually Differed</div>
    <div class="section-title">The graph does the walking</div>
    <div class="section-desc">Opus 5.5 is strong enough to trace a codebase this size by hand. The question is what that costs as the model thinks harder, and what the index still leaves to grep.</div>
    <div class="quality-grid">
      <div class="quality-card">
        <h4><span class="dot dot-ctxo"></span> With ctxo</h4>
        <ul class="quality-list">
          <li>One blast-radius call counted 160 confirmed dependents (51 direct) across C#, procedures and tests</li>
          <li>Data edges link C# methods to the procedures they execute and the tables those procedures read</li>
          <li>The session followed the rules block and skills that ctxo init writes; nobody told it which tool to use</li>
          <li>Fewer output tokens in both settings: 18% at medium, 7% at xhigh (mean of three runs)</li>
          <li>Honest gap: the 8 KB response limit showed 21 of the 160 dependents, so the session traced the rest itself</li>
          <li>Honest gap: two queries assembled from strings are not in the index; the session found them with grep</li>
        </ul>
      </div>
      <div class="quality-card">
        <h4><span class="dot dot-manual"></span> Without ctxo</h4>
        <ul class="quality-list">
          <li>Reached the same 36 entry points, with correct read and write labels</li>
          <li>Walked interfaces, dependency injection and schedulers by hand: 73 shell commands at xhigh</li>
          <li>Followed procedure-to-procedure calls by reading the migration scripts</li>
          <li>Time and cost within run-to-run noise of the ctxo side at both effort levels</li>
          <li>No dependency count, no depth, no confidence tiers; a flat list built from text</li>
        </ul>
      </div>
    </div>
    <div class="verdict-card">
      <h4>Verdict: same answer, fewer tokens; time and cost too close to call</h4>
      <p>Every run on both sides was correct, and that is the honest result: a frontier model can trace this codebase without help. Over three runs per setting, the ctxo sessions wrote fewer output tokens (18% at medium, 7% at xhigh), because the graph had already walked chains the other side walked with shell scripts. Time and cost varied more between runs of the same setting than between the two settings, so this page makes no claim about them. The index is not complete: queries built from strings still need a text search, and the session with ctxo did that check itself.</p>
      <div class="pillars">
        <div class="pillar">
          <h5>Same accuracy</h5>
          <p>35 or 36 of 36 entry points in every run on both sides, scored against a ground truth built without ctxo.</p>
        </div>
        <div class="pillar">
          <h5>Fewer tokens</h5>
          <p>18% fewer output tokens at medium and 7% at xhigh, mean of three runs per setting.</p>
        </div>
        <div class="pillar">
          <h5>Honest gaps</h5>
          <p>SQL assembled from strings is invisible to the index. The rules tell the agent to verify, and it did.</p>
        </div>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="section-eyebrow">Method</div>
    <div class="section-title">How it was run</div>
    <div class="section-desc">Two fresh clones of the repository. In one, <code>ctxo init</code> and <code>ctxo index</code> ran (with <code>dotnet restore</code> first, so the C# analyzer could resolve the SQL call sites); from the other, every ctxo artifact was removed. Each session ran headless with <code>claude -p</code>, Opus 5.5, an empty config directory holding only the login credentials, no session persistence, the repository's own settings and skills, a strict MCP config (ctxo only on the with side), and read-only tools. Each setting ran three times, four sessions at a time. Class, route and table names on this page are generic; the counts are exact. The full method is in the <a href="https://github.com/alperhankendi/Ctxo/blob/master/docs/runbook/comparisons/playbook.md">comparison playbook</a>.</div>
  </section>
</div>

<footer class="page-footer">
  <p>Built with <span class="brand">ctxo</span></p>
  <p class="tagline">AI agents don't fail because they can't code. They fail because they code blind. Ctxo gives them the full picture before they write a single line.</p>
</footer>
