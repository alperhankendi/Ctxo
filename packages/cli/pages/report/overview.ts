import { clear, formatNumber, h, shortId } from './dom.js';
import { computeTrendDelta, renderSparkline } from './sparkline.js';
import type { ReportPayload } from './types.js';

export function renderOverview(root: HTMLElement, payload: ReportPayload): void {
  clear(root);
  root.appendChild(renderHeader(payload));
  root.appendChild(renderKpiGrid(payload));
  root.appendChild(renderGodNodes(payload));
  if (payload.hints.length > 0) root.appendChild(renderHints(payload));
}

function renderHeader(payload: ReportPayload): HTMLElement {
  return h(
    'header',
    { class: 'overview-header' },
    h('h1', {}, payload.projectName),
    h(
      'div',
      { class: 'overview-sub' },
      h('span', { class: 'chip chip-muted' }, `commit ${payload.commitSha}`),
      h('span', { class: 'chip chip-muted' }, `generated ${formatDate(payload.generatedAt)}`),
    ),
  );
}

function renderKpiGrid(payload: ReportPayload): HTMLElement {
  const { kpi } = payload;
  const trend = computeTrendDelta(kpi.modularityTrend);
  const trendArrow = trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→';

  return h(
    'section',
    { class: 'kpi-grid' },
    kpiCard({
      label: 'Modularity',
      value: formatNumber(kpi.modularity),
      meta: kpi.modularityTrend.length > 1
        ? `${trendArrow} ${trend.delta >= 0 ? '+' : ''}${trend.delta.toFixed(3)} vs first snapshot`
        : 'single snapshot — trend unavailable',
      sparkline: kpi.modularityTrend.length > 1 ? kpi.modularityTrend : undefined,
      tone: trend.direction === 'down' ? 'warn' : 'ok',
    }),
    kpiCard({
      label: 'Boundary violations',
      value: String(kpi.violationCount),
      meta: `${kpi.violationHighCount} high · ${kpi.violationMediumCount} medium`,
      tone: kpi.violationHighCount > 0 ? 'bad' : kpi.violationCount > 0 ? 'warn' : 'ok',
    }),
    kpiCard({
      label: 'Drift events',
      value: String(kpi.driftEventCount),
      meta: `confidence: ${kpi.driftConfidence}`,
      tone:
        kpi.driftEventCount === 0 ? 'ok' : kpi.driftConfidence === 'low' ? 'muted' : 'warn',
    }),
    kpiCard({
      label: 'Dead code',
      value: String(kpi.deadCodeCount),
      meta: `${kpi.totalSymbols.toLocaleString()} symbols · ${kpi.totalEdges.toLocaleString()} edges`,
      tone: kpi.deadCodeCount > 0 ? 'warn' : 'ok',
    }),
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  meta: string;
  sparkline?: readonly number[];
  tone: 'ok' | 'warn' | 'bad' | 'muted';
}

function kpiCard(props: KpiCardProps): HTMLElement {
  const card = h(
    'div',
    { class: `kpi-card kpi-${props.tone}` },
    h('div', { class: 'kpi-label' }, props.label),
    h('div', { class: 'kpi-value' }, props.value),
    h('div', { class: 'kpi-meta' }, props.meta),
  );
  if (props.sparkline && props.sparkline.length > 1) {
    const sparkWrap = h('div', { class: 'kpi-sparkline' });
    sparkWrap.appendChild(renderSparkline(props.sparkline));
    card.appendChild(sparkWrap);
  }
  return card;
}

function renderGodNodes(payload: ReportPayload): HTMLElement {
  const section = h(
    'section',
    { class: 'panel' },
    h(
      'div',
      { class: 'panel-header' },
      h('h2', {}, 'Top god nodes'),
      h(
        'span',
        { class: 'panel-sub' },
        'Symbols bridging many communities. High centrality = high blast radius.',
      ),
    ),
  );
  if (payload.godNodes.length === 0) {
    section.appendChild(h('p', { class: 'empty' }, 'No god nodes detected. Healthy coupling.'));
    return section;
  }

  const list = h('ol', { class: 'godnode-list' });
  const top = payload.godNodes.slice(0, 5);
  for (const node of top) {
    list.appendChild(
      h(
        'li',
        {},
        h('span', { class: 'godnode-name' }, shortId(node.symbolId)),
        h(
          'span',
          { class: 'godnode-meta' },
          `${node.bridgedCommunities.length} communities · centrality ${node.centralityScore.toFixed(3)}`,
        ),
      ),
    );
  }
  section.appendChild(list);
  return section;
}

function renderHints(payload: ReportPayload): HTMLElement {
  return h(
    'aside',
    { class: 'hints' },
    ...payload.hints.map((text) => h('div', { class: 'hint' }, text)),
  );
}

function formatDate(iso: string): string {
  return iso.includes('T') ? iso.split('T')[0]! : iso;
}
