/**
 * `@ctxo/cli/internal`: the API an opt-in module such as `@ctxo/domain` builds against (ADR-018).
 *
 * Types only, plus one runtime function, `createModuleHost`. Modules import the types with `import type`;
 * every runtime service reaches them through `host.services`. No adapter is exported. The API changes only
 * in minor releases. This file is a package entry and the one exception to the no-barrel rule.
 */

import type { SymbolGraph as SymbolGraphClass } from './core/graph/symbol-graph.js';
import type { BlastRadiusCalculator as BlastRadiusCalculatorClass } from './core/blast-radius/blast-radius-calculator.js';

// The module API
export type {
  CoreToolName,
  ResponseEnricher,
  TokenReservation,
  RankedContextScope,
  ModuleToolDefinition,
  ToolRegistrar,
  ModuleCommandContext,
  ModuleCommand,
  CommandRegistrar,
  TestFileCheck,
  CoChangeWindowCommits,
  IndexPassContext,
  WatchPathKind,
  InitFileResult,
  ClaudeHookEntry,
  InitPrompter,
  InitPartContext,
  InitContribution,
  DoctorFixContext,
  ModuleDoctorFix,
  CtxoModuleRegistration,
  DocumentSearch,
  CtxoHostServices,
  CtxoHost,
  CtxoModuleRegister,
  TrivialLiteral,
  FactDetectorOptions,
} from './ports/i-ctxo-module.js';

// Core types
export type {
  FileIndex,
  SymbolNode,
  GraphEdge,
  SymbolKind,
  EdgeKind,
  FileChange,
  FileChangeStatus,
  CommitChangeSet,
  ChangeLog,
  RangeCommit,
  GitRange,
  GitRefs,
  CoChangeEntry,
  CodeFact,
  FactKind,
  SearchDocument,
  SearchResponse,
  SearchResult,
  SearchMetrics,
} from './core/types.js';

// Ports
export type { IGitPort } from './ports/i-git-port.js';
export type { IStoragePort } from './ports/i-storage-port.js';
export type { IMaskingPort } from './ports/i-masking-port.js';

// Config, logging, diagnostics, graph and envelope types
export type { CtxoConfig } from './core/config/config-schema.js';
export type { LoadedConfig } from './core/config/load-config.js';
export type { Logger } from './core/logger.js';
export type { IHealthCheck, CheckContext, CheckResult, CheckStatus } from './core/diagnostics/types.js';
export type { ResponseMeta } from './core/response-envelope.js';

// The two classes go out as type aliases of their instance types: a bundled declaration file drops the
// `type` of `export type { SomeClass }`, which would let a module `new` a class this entry never exports.
export type SymbolGraph = SymbolGraphClass;
export type BlastRadiusCalculator = BlastRadiusCalculatorClass;

// Runtime
export { createModuleHost } from './cli/module-host.js';
