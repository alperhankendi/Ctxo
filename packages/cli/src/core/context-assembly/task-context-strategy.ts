export type TaskType = 'fix' | 'extend' | 'refactor' | 'understand';

export interface ScoringWeights {
  readonly directDependency: number;
  readonly interfaceTypeDef: number;
  readonly blastRadiusDependent: number;
  readonly highComplexity: number;
  readonly antiPatternHistory: number;
}

const TASK_WEIGHTS: Record<TaskType, ScoringWeights> = {
  fix: {
    directDependency: 0.3,
    interfaceTypeDef: 0.1,
    blastRadiusDependent: 0.1,
    highComplexity: 0.2,
    antiPatternHistory: 0.3,
  },
  extend: {
    directDependency: 0.4,
    interfaceTypeDef: 0.5,
    blastRadiusDependent: 0.1,
    highComplexity: 0.0,
    antiPatternHistory: 0.0,
  },
  refactor: {
    directDependency: 0.2,
    interfaceTypeDef: 0.1,
    blastRadiusDependent: 0.5,
    highComplexity: 0.1,
    antiPatternHistory: 0.1,
  },
  understand: {
    directDependency: 0.5,
    interfaceTypeDef: 0.3,
    blastRadiusDependent: 0.1,
    highComplexity: 0.1,
    antiPatternHistory: 0.0,
  },
};

export function getWeightsForTask(taskType: TaskType): ScoringWeights {
  return TASK_WEIGHTS[taskType];
}
