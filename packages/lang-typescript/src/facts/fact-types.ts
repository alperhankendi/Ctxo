// Shared fact contract types (PR 4, issue #156). This file is copied unchanged into every official
// language plugin; only import paths may differ. The rules are pinned by
// packages/plugin-api/conformance/fact-vectors.json.
import type { FactKind } from '@ctxo/plugin-api';

/** The kind of a literal operand, as the collector saw it in the source. */
export type LiteralKind = 'number' | 'string' | 'char' | 'boolean' | 'null';

/** Duration units of `retry-timeout` facts built from duration constructors. */
export type DurationUnit = 'ns' | 'us' | 'ms' | 's' | 'min' | 'h' | 'd';

/**
 * Syntactic evidence a collector (an analyzer or a CST walker) reports; `finishFacts` turns it
 * into `CodeFact`s. `symbolId` is set by collectors that know the enclosing declaration; the
 * finisher attributes the rest by line. `line` is 0-based.
 */
export type FactEvidence =
  | {
      readonly kind: 'comparison';
      readonly symbolId?: string;
      readonly line: number;
      readonly text: string;
      readonly operator: string;
      readonly literal: string;
      readonly literalKind: LiteralKind;
    }
  | {
      readonly kind: 'call';
      readonly symbolId?: string;
      readonly line: number;
      readonly text: string;
      readonly method: string;
      readonly qualifier?: string;
      /**
       * Where the call's value goes (FC-4b): the callee of the nearest call that receives it as an
       * argument (`Logger.Warn`, `errors.New`; a construction is `new <Type>`), through
       * concatenation, interpolation, parentheses, conditionals and the call's own receiver chain, up
       * to the enclosing statement and never out of a lambda or function. Absent when there is none.
       */
      readonly consumer?: string;
      /**
       * FC-4b, full tiers only: the consumer's receiver type and the type that declares its method
       * (qualified, type arguments dropped; Go: the package path or `<path>.<type>`), when they
       * resolve. Absent in the syntax tiers, so the rules fall back to names.
       */
      readonly consumerTypes?: readonly string[];
      /**
       * FC-4b: true when, on the way to the consumer, the value is a hole of an interpolated or
       * template string, or an operand of a `+` chain with a string literal, whose literal text holds
       * ASCII whitespace (text for people).
       */
      readonly inProse?: boolean;
    }
  | {
      readonly kind: 'binding';
      readonly symbolId?: string;
      readonly line: number;
      readonly name: string;
      /** Source text of the bound value. */
      readonly value: string;
    }
  | {
      readonly kind: 'duration';
      readonly symbolId?: string;
      readonly line: number;
      readonly name?: string;
      readonly constructor: string;
      readonly unit: DurationUnit;
      readonly amount: string;
    }
  | {
      readonly kind: 'route';
      readonly symbolId?: string;
      readonly line: number;
      readonly verb: string;
      readonly route: string;
    };

/**
 * A language's string literal decoder: gets the trimmed source of a string or char literal that is
 * not a plain quoted one (prefixes, suffixes, verbatim, interpolated, raw, single-quoted or template
 * strings, text blocks) and returns its content, or undefined when the literal is not a string
 * constant (for example an interpolation hole, or a form that does not compile). The shared rules
 * decode only a plain `"..."` string or `'...'` char with the common escapes.
 */
export type StringLiteralDecoder = (literal: string) => string | undefined;

/** A literal value the detectors treat as trivial: numbers, strings, booleans and `null`. */
export type TrivialLiteral = number | string | boolean | null;

/** Fact detector options, delivered by the host as `PluginContext.config.facts`. */
export interface FactOptions {
  readonly trivialLiterals: readonly TrivialLiteral[];
  readonly normalizationMethods: readonly string[];
}

/** Fact kinds in sort order (the same order as `FACT_KINDS`, kept local so no runtime import is needed). */
export const FACT_KIND_ORDER: readonly FactKind[] = ['literal-comparison', 'normalization', 'retry-timeout', 'endpoint'];
