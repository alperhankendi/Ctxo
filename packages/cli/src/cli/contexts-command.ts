import { join } from 'node:path';
import { ContextsViewReader } from '../adapters/storage/contexts-view-reader.js';

export interface ContextsOptions {
  json?: boolean;
}

const NO_VIEW_HINT = 'No contexts view. Run ctxo index (without --skip-community).';

export class ContextsCommand {
  private readonly ctxoRoot: string;

  constructor(projectRoot: string) {
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  run(options: ContextsOptions): void {
    const view = new ContextsViewReader(this.ctxoRoot).readContextsView();

    if (options.json) {
      process.stdout.write(
        view
          ? JSON.stringify(view, null, 2) + '\n'
          : JSON.stringify({ found: false, hint: NO_VIEW_HINT }) + '\n',
      );
      return;
    }

    if (!view) {
      console.error(NO_VIEW_HINT);
      return;
    }

    const { coverage, candidates, hubs, unclustered, collisions } = view;
    const shared = view.dataResources.filter((resource) => resource.accesses.length >= 2);
    const pct = Math.round(coverage.ratio * 100);
    const lines = [
      `[ctxo] Contexts view at ${view.commitSha}: ${candidates.length} candidates cover ${coverage.covered}/${coverage.files} files (${pct}%), ${hubs.length} hubs, ${unclustered.count} unclustered, ${collisions.length} collisions, ${shared.length} shared tables`,
    ];
    for (const c of candidates) {
      const terms = c.topTerms.slice(0, 3).map((t) => t.term).join(', ');
      const tables = c.sharedTables.length > 0 ? ` shared tables: ${c.sharedTables.length}` : '';
      lines.push(`#${c.id}  ${c.fileCount} files  cohesion ${c.cohesion}  ${c.label}  terms: ${terms}${tables}`);
    }
    for (const h of hubs) {
      const target = h.candidate === undefined ? 'unassigned' : `#${h.candidate}`;
      lines.push(`hub ${h.file} (${h.reasons.join(', ')}, ${h.dependents} dependents) -> ${target}`);
    }
    for (const r of shared) {
      const kind = r.external ? 'external' : (r.kind ?? 'table');
      const accesses = r.accesses.map((a) => `#${a.candidate} ${a.modes.join('+')}`).join(', ');
      const writers =
        r.owner !== undefined ? `owner #${r.owner}` : r.writers.length > 1 ? 'several writers' : 'read only';
      lines.push(`shared ${kind} ${r.name}  ${accesses}  ${writers}`);
    }
    console.error(lines.join('\n'));
  }
}
