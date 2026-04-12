export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  readonly message: string;
  readonly fix?: string;
  readonly value?: string;
}

export interface CheckContext {
  readonly projectRoot: string;
  readonly ctxoRoot: string;
  readonly indices?: readonly import('../types.js').FileIndex[];
}

export interface IHealthCheck {
  readonly id: string;
  readonly title: string;
  run(ctx: CheckContext): Promise<CheckResult>;
}

export interface DoctorSummary {
  readonly pass: number;
  readonly warn: number;
  readonly fail: number;
}

export interface DoctorReport {
  readonly checks: readonly CheckResult[];
  readonly summary: DoctorSummary;
  readonly exitCode: 0 | 1;
}
