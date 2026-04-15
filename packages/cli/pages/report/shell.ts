import { renderOverview } from './overview.js';
import type { ReportPayload } from './types.js';

type ViewId = 'overview' | 'structure' | 'drift' | 'violations' | 'hotspots';

interface ViewDef {
  readonly id: ViewId;
  readonly label: string;
  readonly render: (root: HTMLElement, payload: ReportPayload) => void;
}

const VIEWS: readonly ViewDef[] = [
  { id: 'overview', label: 'Overview', render: renderOverview },
  { id: 'structure', label: 'Structure', render: renderPlaceholder('Structure') },
  { id: 'drift', label: 'Drift', render: renderPlaceholder('Drift') },
  { id: 'violations', label: 'Violations', render: renderPlaceholder('Violations') },
  { id: 'hotspots', label: 'Hotspots', render: renderPlaceholder('Hotspots') },
];

function renderPlaceholder(title: string) {
  return (root: HTMLElement): void => {
    while (root.firstChild) root.removeChild(root.firstChild);
    const wrap = document.createElement('section');
    wrap.className = 'panel';
    const header = document.createElement('div');
    header.className = 'panel-header';
    const h2 = document.createElement('h2');
    h2.textContent = title;
    header.appendChild(h2);
    wrap.appendChild(header);
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Coming in a future milestone.';
    wrap.appendChild(p);
    root.appendChild(wrap);
  };
}

function renderNoPayload(root: HTMLElement): void {
  while (root.firstChild) root.removeChild(root.firstChild);
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';
  const h2 = document.createElement('h2');
  h2.textContent = 'No report data';
  wrap.appendChild(h2);
  const p = document.createElement('p');
  p.appendChild(document.createTextNode('Run '));
  const code = document.createElement('code');
  code.textContent = 'ctxo report';
  p.appendChild(code);
  p.appendChild(document.createTextNode(' to generate this dashboard with real data.'));
  wrap.appendChild(p);
  root.appendChild(wrap);
}

function bootstrap(): void {
  const payload: ReportPayload | null = (window as unknown as {
    CTXO_REPORT_DATA: ReportPayload | null;
  }).CTXO_REPORT_DATA;
  const titleEl = document.querySelector<HTMLElement>('[data-title]');
  const tabsEl = document.querySelector<HTMLElement>('[data-tabs]');
  const contentEl = document.querySelector<HTMLElement>('[data-content]');

  if (!tabsEl || !contentEl) return;

  if (!payload) {
    renderNoPayload(contentEl);
    return;
  }

  if (titleEl) titleEl.textContent = `${payload.projectName} — Architectural Report`;
  document.title = `${payload.projectName} · Ctxo Report`;

  let active: ViewId = 'overview';

  const renderActive = (): void => {
    const view = VIEWS.find((v) => v.id === active) ?? VIEWS[0]!;
    view.render(contentEl, payload);
    for (const btn of tabsEl.querySelectorAll<HTMLElement>('[data-tab]')) {
      btn.classList.toggle('active', btn.dataset['tab'] === active);
    }
  };

  while (tabsEl.firstChild) tabsEl.removeChild(tabsEl.firstChild);
  for (const view of VIEWS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset['tab'] = view.id;
    btn.className = 'tab';
    btn.textContent = view.label;
    btn.addEventListener('click', () => {
      active = view.id;
      renderActive();
    });
    tabsEl.appendChild(btn);
  }

  renderActive();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
