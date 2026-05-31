import type { ResolvedGate } from './gate-config.js';

const MAX_TOP_DEPENDENTS = 8;

export interface GateInput {
  /** confirmed + likely dependents of the edited symbol (primary risk signal). */
  readonly riskCount: number;
  /** PageRank of the edited symbol. */
  readonly importanceScore: number;
  /** PageRank value at the top-percentile boundary for this repo. */
  readonly importanceCutoff: number;
}

export function shouldBlock(input: GateInput, t: ResolvedGate): boolean {
  if (!t.enabled) return false;
  return input.riskCount >= t.minDependents && input.importanceScore >= input.importanceCutoff;
}

/** One-time guard message injected into the block reason. */
export function formatBlockReason(
  symbolName: string,
  riskCount: number,
  topDependents: readonly string[],
): string {
  const list = topDependents.slice(0, MAX_TOP_DEPENDENTS).map((d) => `  - ${d}`).join('\n');
  return [
    `⚠ ctxo guard: "${symbolName}" is a high-impact symbol - ${riskCount} confirmed/likely dependents may break.`,
    topDependents.length > 0 ? `Top dependents:\n${list}` : '',
    `Call get_blast_radius / get_why_context before editing. This guard fires once per symbol per session - re-issue the edit to proceed.`,
  ].filter(Boolean).join('\n');
}
