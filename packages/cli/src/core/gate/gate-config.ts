import type { GateConfig } from '../config/config-schema.js';

export interface ResolvedGate {
  readonly enabled: boolean;
  readonly percentile: number;
  readonly minDependents: number;
}

const DIAL: Record<NonNullable<GateConfig['sensitivity']>, { percentile: number; minDependents: number }> = {
  strict: { percentile: 30, minDependents: 2 },
  balanced: { percentile: 15, minDependents: 3 },
  lenient: { percentile: 5, minDependents: 5 },
};

export function resolveGateThresholds(gate: GateConfig | undefined): ResolvedGate {
  const dial = DIAL[gate?.sensitivity ?? 'balanced'];
  return {
    enabled: gate?.enabled ?? true,
    percentile: gate?.percentile ?? dial.percentile,
    minDependents: gate?.minDependents ?? dial.minDependents,
  };
}
