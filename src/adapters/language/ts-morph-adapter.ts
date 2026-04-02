import {
  Project,
  SyntaxKind,
  Node,
  type SourceFile,
  type FunctionDeclaration,
  type MethodDeclaration,
  ScriptTarget,
} from 'ts-morph';
import { extname, dirname, join, normalize } from 'node:path';
import { type SymbolNode, type GraphEdge, type ComplexityMetrics, type SymbolKind, SYMBOL_KINDS } from '../../core/types.js';
import type { ILanguageAdapter } from '../../ports/i-language-adapter.js';

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

export class TsMorphAdapter implements ILanguageAdapter {
  readonly extensions = SUPPORTED_EXTENSIONS;
  readonly tier = 'full' as const;

  private readonly project: Project;
  private symbolRegistry = new Map<string, SymbolKind>();

  constructor() {
    this.project = new Project({
      compilerOptions: {
        target: ScriptTarget.ES2022,
        allowJs: true,
        jsx: 2, // React
        skipLibCheck: true,
      },
      useInMemoryFileSystem: true,
    });
  }

  isSupported(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
  }

  setSymbolRegistry(registry: Map<string, SymbolKind>): void {
    this.symbolRegistry = registry;
  }

  extractSymbols(filePath: string, source: string): SymbolNode[] {
    const sourceFile = this.parseSource(filePath, source);
    if (!sourceFile) return [];

    try {
      const symbols: SymbolNode[] = [];

      this.extractFunctions(sourceFile, filePath, symbols);
      this.extractClasses(sourceFile, filePath, symbols);
      this.extractInterfaces(sourceFile, filePath, symbols);
      this.extractTypeAliases(sourceFile, filePath, symbols);
      this.extractVariables(sourceFile, filePath, symbols);

      return symbols;
    } catch (err) {
      console.error(`[ctxo:ts-morph] Symbol extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    } finally {
      this.cleanupSourceFile(filePath);
    }
  }

  extractEdges(filePath: string, source: string): GraphEdge[] {
    const sourceFile = this.parseSource(filePath, source);
    if (!sourceFile) return [];

    try {
      const edges: GraphEdge[] = [];

      this.extractImportEdges(sourceFile, filePath, edges);
      this.extractInheritanceEdges(sourceFile, filePath, edges);
      this.extractCallEdges(sourceFile, filePath, edges);
      this.extractReferenceEdges(sourceFile, filePath, edges);

      return edges;
    } catch (err) {
      console.error(`[ctxo:ts-morph] Edge extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    } finally {
      this.cleanupSourceFile(filePath);
    }
  }

  extractComplexity(filePath: string, source: string): ComplexityMetrics[] {
    const sourceFile = this.parseSource(filePath, source);
    if (!sourceFile) return [];

    try {
      const metrics: ComplexityMetrics[] = [];

      for (const fn of sourceFile.getFunctions()) {
        if (!this.isExported(fn)) continue;
        const name = fn.getName();
        if (!name) continue;
        const symbolId = this.buildSymbolId(filePath, name, 'function');
        metrics.push({ symbolId, cyclomatic: this.countCyclomaticComplexity(fn) });
      }

      for (const cls of sourceFile.getClasses()) {
        const className = cls.getName();
        if (!className || !this.isExported(cls)) continue;

        for (const method of cls.getMethods()) {
          const methodName = method.getName();
          const symbolId = this.buildSymbolId(filePath, `${className}.${methodName}`, 'method');
          metrics.push({ symbolId, cyclomatic: this.countCyclomaticComplexity(method) });
        }
      }

      return metrics;
    } catch (err) {
      console.error(`[ctxo:ts-morph] Complexity extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    } finally {
      this.cleanupSourceFile(filePath);
    }
  }

  // ── Symbol Extraction ───────────────────────────────────────

  private extractFunctions(
    sourceFile: SourceFile,
    filePath: string,
    symbols: SymbolNode[],
  ): void {
    for (const fn of sourceFile.getFunctions()) {
      if (!this.isExported(fn)) continue;
      const name = fn.getName();
      if (!name) continue;

      symbols.push({
        symbolId: this.buildSymbolId(filePath, name, 'function'),
        name,
        kind: 'function',
        startLine: fn.getStartLineNumber() - 1,
        endLine: fn.getEndLineNumber() - 1,
        startOffset: fn.getStart(),
        endOffset: fn.getEnd(),
      });
    }
  }

  private extractClasses(
    sourceFile: SourceFile,
    filePath: string,
    symbols: SymbolNode[],
  ): void {
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (!name || !this.isExported(cls)) continue;

      symbols.push({
        symbolId: this.buildSymbolId(filePath, name, 'class'),
        name,
        kind: 'class',
        startLine: cls.getStartLineNumber() - 1,
        endLine: cls.getEndLineNumber() - 1,
        startOffset: cls.getStart(),
        endOffset: cls.getEnd(),
      });

      // Extract methods
      for (const method of cls.getMethods()) {
        const methodName = method.getName();
        symbols.push({
          symbolId: this.buildSymbolId(filePath, `${name}.${methodName}`, 'method'),
          name: `${name}.${methodName}`,
          kind: 'method',
          startLine: method.getStartLineNumber() - 1,
          endLine: method.getEndLineNumber() - 1,
          startOffset: method.getStart(),
          endOffset: method.getEnd(),
        });
      }
    }
  }

  private extractInterfaces(
    sourceFile: SourceFile,
    filePath: string,
    symbols: SymbolNode[],
  ): void {
    for (const iface of sourceFile.getInterfaces()) {
      if (!this.isExported(iface)) continue;
      const name = iface.getName();

      symbols.push({
        symbolId: this.buildSymbolId(filePath, name, 'interface'),
        name,
        kind: 'interface',
        startLine: iface.getStartLineNumber() - 1,
        endLine: iface.getEndLineNumber() - 1,
        startOffset: iface.getStart(),
        endOffset: iface.getEnd(),
      });
    }
  }

  private extractTypeAliases(
    sourceFile: SourceFile,
    filePath: string,
    symbols: SymbolNode[],
  ): void {
    for (const typeAlias of sourceFile.getTypeAliases()) {
      if (!this.isExported(typeAlias)) continue;
      const name = typeAlias.getName();

      symbols.push({
        symbolId: this.buildSymbolId(filePath, name, 'type'),
        name,
        kind: 'type',
        startLine: typeAlias.getStartLineNumber() - 1,
        endLine: typeAlias.getEndLineNumber() - 1,
        startOffset: typeAlias.getStart(),
        endOffset: typeAlias.getEnd(),
      });
    }
  }

  private extractVariables(
    sourceFile: SourceFile,
    filePath: string,
    symbols: SymbolNode[],
  ): void {
    for (const stmt of sourceFile.getVariableStatements()) {
      if (!this.isExported(stmt)) continue;

      for (const decl of stmt.getDeclarations()) {
        const name = decl.getName();

        symbols.push({
          symbolId: this.buildSymbolId(filePath, name, 'variable'),
          name,
          kind: 'variable',
          startLine: stmt.getStartLineNumber() - 1,
          endLine: stmt.getEndLineNumber() - 1,
          startOffset: decl.getStart(),
          endOffset: decl.getEnd(),
        });
      }
    }
  }

  // ── Edge Extraction ─────────────────────────────────────────

  private extractImportEdges(
    sourceFile: SourceFile,
    filePath: string,
    edges: GraphEdge[],
  ): void {
    // BUG-1 FIX: use sourceFile directly instead of project lookup (file may be cleaned up)
    const fileSymbolId = this.buildSymbolId(filePath, sourceFile.getBaseName().replace(/\.[^.]+$/, ''), 'variable');
    const fromSymbols = this.getExportedSymbolIds(sourceFile, filePath);
    const fromSymbol = fromSymbols.length > 0 ? fromSymbols[0]! : fileSymbolId;

    for (const imp of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = imp.getModuleSpecifierValue();

      // Only track local imports (relative paths)
      if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) {
        continue;
      }

      // Resolve relative import to project-relative path
      const normalizedTarget = this.resolveRelativeImport(filePath, moduleSpecifier);

      // SCHEMA-40 FIX: detect type-only imports
      const isTypeOnly = imp.isTypeOnly();

      for (const named of imp.getNamedImports()) {
        const importedName = named.getName();
        const edge: GraphEdge = {
          from: fromSymbol,
          to: this.resolveImportTarget(normalizedTarget, importedName),
          kind: 'imports',
        };
        if (isTypeOnly || named.isTypeOnly()) edge.typeOnly = true;
        edges.push(edge);
      }

      const defaultImport = imp.getDefaultImport();
      if (defaultImport) {
        const edge: GraphEdge = {
          from: fromSymbol,
          to: this.resolveImportTarget(normalizedTarget, defaultImport.getText()),
          kind: 'imports',
        };
        if (isTypeOnly) edge.typeOnly = true;
        edges.push(edge);
      }

      // GAP-3 FIX: namespace imports (import * as X from './mod')
      const nsImport = imp.getNamespaceImport();
      if (nsImport) {
        const edge: GraphEdge = {
          from: fromSymbol,
          to: this.buildSymbolId(normalizedTarget, nsImport.getText(), 'variable'),
          kind: 'imports',
        };
        if (isTypeOnly) edge.typeOnly = true;
        edges.push(edge);
      }
    }
  }

  private extractInheritanceEdges(
    sourceFile: SourceFile,
    filePath: string,
    edges: GraphEdge[],
  ): void {
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName();
      if (!className || !this.isExported(cls)) continue;

      const classSymbolId = this.buildSymbolId(filePath, className, 'class');

      // extends
      const baseClass = cls.getExtends();
      if (baseClass) {
        // BUG-17 FIX: strip generic type arguments (Base<string> → Base)
        const baseName = baseClass.getExpression().getText().replace(/<.*>$/, '');
        edges.push({
          from: classSymbolId,
          to: this.resolveSymbolReference(sourceFile, baseName, 'class'),
          kind: 'extends',
        });
      }

      // implements
      for (const impl of cls.getImplements()) {
        // BUG-18 FIX: strip generic type arguments (IRepo<User> → IRepo)
        const ifaceName = impl.getExpression().getText().replace(/<.*>$/, '');
        edges.push({
          from: classSymbolId,
          to: this.resolveSymbolReference(sourceFile, ifaceName, 'interface'),
          kind: 'implements',
        });
      }
    }
  }

  private extractCallEdges(
    sourceFile: SourceFile,
    filePath: string,
    edges: GraphEdge[],
  ): void {
    // Extract function call edges from exported functions and methods
    for (const fn of sourceFile.getFunctions()) {
      if (!this.isExported(fn)) continue;
      const fnName = fn.getName();
      if (!fnName) continue;

      const fnSymbolId = this.buildSymbolId(filePath, fnName, 'function');

      for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const calledName = call.getExpression().getText().split('.').pop();
        if (!calledName || calledName === fnName) continue;

        const resolved = this.resolveLocalCallTarget(sourceFile, filePath, calledName);
        if (resolved) {
          edges.push({ from: fnSymbolId, to: resolved, kind: 'calls' });
        }
      }

      // GAP-11 FIX: constructor calls (new Foo())
      for (const newExpr of fn.getDescendantsOfKind(SyntaxKind.NewExpression)) {
        const calledName = newExpr.getExpression().getText().split('.').pop();
        if (!calledName) continue;

        const resolved = this.resolveLocalCallTarget(sourceFile, filePath, calledName);
        if (resolved) {
          edges.push({ from: fnSymbolId, to: resolved, kind: 'calls' });
        }
      }
    }

    // Extract calls from class methods
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName();
      if (!className || !this.isExported(cls)) continue;

      for (const method of cls.getMethods()) {
        const methodName = method.getName();
        const methodSymbolId = this.buildSymbolId(filePath, `${className}.${methodName}`, 'method');

        for (const call of method.getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const calledText = call.getExpression().getText();
          const calledName = calledText.split('.').pop();
          if (!calledName || calledName === methodName) continue;

          // Skip this.xxx calls (internal method calls)
          if (calledText.startsWith('this.')) continue;

          const resolved = this.resolveLocalCallTarget(sourceFile, filePath, calledName);
          if (resolved) {
            edges.push({ from: methodSymbolId, to: resolved, kind: 'calls' });
          }
        }

        // GAP-11 FIX: constructor calls from methods (new Foo())
        for (const newExpr of method.getDescendantsOfKind(SyntaxKind.NewExpression)) {
          const calledText = newExpr.getExpression().getText();
          const calledName = calledText.split('.').pop();
          if (!calledName) continue;
          if (calledText.startsWith('this.')) continue;

          const resolved = this.resolveLocalCallTarget(sourceFile, filePath, calledName);
          if (resolved) {
            edges.push({ from: methodSymbolId, to: resolved, kind: 'calls' });
          }
        }
      }
    }
  }

  private extractReferenceEdges(
    sourceFile: SourceFile,
    filePath: string,
    edges: GraphEdge[],
  ): void {
    // Build map of all named imports from local modules: importedName → resolved symbolId
    const importMap = new Map<string, string>();
    for (const imp of sourceFile.getImportDeclarations()) {
      const mod = imp.getModuleSpecifierValue();
      if (!mod.startsWith('.') && !mod.startsWith('/')) continue;
      const targetFile = this.resolveRelativeImport(filePath, mod);
      for (const named of imp.getNamedImports()) {
        importMap.set(named.getName(), this.resolveImportTarget(targetFile, named.getName()));
      }
      const defaultImport = imp.getDefaultImport();
      if (defaultImport) {
        importMap.set(defaultImport.getText(), this.resolveImportTarget(targetFile, defaultImport.getText()));
      }
    }
    if (importMap.size === 0) return;

    // Scan each exported symbol's body for identifier references to imports
    for (const fn of sourceFile.getFunctions()) {
      if (!this.isExported(fn)) continue;
      const fnName = fn.getName();
      if (!fnName) continue;
      const fromId = this.buildSymbolId(filePath, fnName, 'function');
      this.emitUsesEdges(fn, fromId, importMap, edges);
    }

    for (const cls of sourceFile.getClasses()) {
      if (!this.isExported(cls)) continue;
      const className = cls.getName();
      if (!className) continue;

      // Class-level references (property types, constructor params)
      const classId = this.buildSymbolId(filePath, className, 'class');
      this.emitUsesEdges(cls, classId, importMap, edges);
    }
  }

  private emitUsesEdges(
    node: Node,
    fromId: string,
    importMap: Map<string, string>,
    edges: GraphEdge[],
  ): void {
    const seen = new Set<string>();
    for (const id of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const name = id.getText();
      if (seen.has(name)) continue;
      const target = importMap.get(name);
      if (target) {
        seen.add(name);
        edges.push({ from: fromId, to: target, kind: 'uses' });
      }
    }
  }

  private resolveLocalCallTarget(
    sourceFile: SourceFile,
    filePath: string,
    calledName: string,
  ): string | undefined {
    // Check if the called name is imported from a local module
    for (const imp of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = imp.getModuleSpecifierValue();
      if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) continue;

      for (const named of imp.getNamedImports()) {
        if (named.getName() === calledName) {
          const targetFile = this.resolveRelativeImport(filePath, moduleSpecifier);
          return this.resolveImportTarget(targetFile, calledName);
        }
      }
    }

    // Check if it's a locally defined function in the same file
    for (const fn of sourceFile.getFunctions()) {
      if (fn.getName() === calledName) {
        return this.buildSymbolId(filePath, calledName, 'function');
      }
    }

    return undefined;
  }

  // ── Helpers ─────────────────────────────────────────────────

  private parseSource(filePath: string, source: string): SourceFile | undefined {
    try {
      const existing = this.project.getSourceFile(filePath);
      if (existing) {
        this.project.removeSourceFile(existing);
      }
      return this.project.createSourceFile(filePath, source, { overwrite: true });
    } catch (err) {
      console.error(`[ctxo:ts-morph] Parse failed for ${filePath}: ${(err as Error).message}`);
      return undefined;
    }
  }

  private cleanupSourceFile(filePath: string): void {
    const existing = this.project.getSourceFile(filePath);
    if (existing) {
      this.project.removeSourceFile(existing);
    }
  }

  private buildSymbolId(filePath: string, name: string, kind: SymbolKind): string {
    return `${filePath}::${name}::${kind}`;
  }

  private resolveRelativeImport(fromFile: string, moduleSpecifier: string): string {
    // Convert relative import like '../types.js' to project-relative 'src/core/types.ts'
    const fromDir = dirname(fromFile);
    let resolved = normalize(join(fromDir, moduleSpecifier)).replace(/\\/g, '/');

    // Strip .js extension (TypeScript imports use .js but source files are .ts)
    if (resolved.endsWith('.js')) {
      resolved = resolved.slice(0, -3) + '.ts';
    } else if (resolved.endsWith('.jsx')) {
      resolved = resolved.slice(0, -4) + '.tsx';
    } else if (!extname(resolved)) {
      resolved += '.ts';
    }

    return resolved;
  }

  private resolveImportTarget(targetFile: string, name: string): string {
    // BUG-8/9 FIX: check symbol registry first (populated from Phase 1 of indexing)
    const prefix = `${targetFile}::${name}::`;
    for (const kind of SYMBOL_KINDS) {
      if (this.symbolRegistry.has(`${prefix}${kind}`)) {
        return `${prefix}${kind}`;
      }
    }

    // Try to find the symbol in the already-parsed project to get the correct kind
    const targetSourceFile = this.project.getSourceFile(targetFile);
    if (targetSourceFile) {
      for (const fn of targetSourceFile.getFunctions()) {
        if (fn.getName() === name && this.isExported(fn)) {
          return this.buildSymbolId(targetFile, name, 'function');
        }
      }
      for (const cls of targetSourceFile.getClasses()) {
        if (cls.getName() === name && this.isExported(cls)) {
          return this.buildSymbolId(targetFile, name, 'class');
        }
      }
      for (const iface of targetSourceFile.getInterfaces()) {
        if (iface.getName() === name && this.isExported(iface)) {
          return this.buildSymbolId(targetFile, name, 'interface');
        }
      }
      for (const t of targetSourceFile.getTypeAliases()) {
        if (t.getName() === name && this.isExported(t)) {
          return this.buildSymbolId(targetFile, name, 'type');
        }
      }
    }
    // Fallback: infer kind from naming conventions
    const kind = this.inferSymbolKind(name);
    return `${targetFile}::${name}::${kind}`;
  }

  private resolveSymbolReference(
    sourceFile: SourceFile,
    name: string,
    defaultKind: SymbolKind,
  ): string {
    // Check if the name is imported
    for (const imp of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = imp.getModuleSpecifierValue();
      if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) continue;

      for (const named of imp.getNamedImports()) {
        if (named.getName() === name) {
          const resolved = imp.getModuleSpecifierSourceFile()?.getFilePath();
          if (resolved) {
            return `${this.normalizeFilePath(resolved)}::${name}::${defaultKind}`;
          }
          // Fallback: resolve relative module specifier manually
          const sourceDir = dirname(this.normalizeFilePath(sourceFile.getFilePath()));
          const resolvedPath = normalize(join(sourceDir, moduleSpecifier))
            .replace(/\\/g, '/')
            .replace(/\.jsx$/, '.tsx')
            .replace(/\.js$/, '.ts');
          return `${resolvedPath}::${name}::${defaultKind}`;
        }
      }
    }

    // Assume it's in the same file
    return `${sourceFile.getFilePath()}::${name}::${defaultKind}`;
  }

  private inferSymbolKind(name: string): SymbolKind {
    // Interface: starts with I followed by uppercase (IStoragePort, IGitPort)
    if (/^I[A-Z]/.test(name) && name.length > 2) return 'interface';
    // All caps with underscores: variable/constant (MAX_AMOUNT, EDGE_KINDS)
    if (/^[A-Z][A-Z_0-9]+$/.test(name)) return 'variable';
    // PascalCase: could be class, interface, or type — default to class
    if (/^[A-Z]/.test(name)) return 'class';
    // camelCase: function
    return 'function';
  }

  private normalizeFilePath(filePath: string): string {
    // Remove leading / from in-memory file system paths
    return filePath.replace(/^\//, '');
  }

  private getExportedSymbolIds(sourceFile: SourceFile, filePath: string): string[] {
    const ids: string[] = [];
    for (const fn of sourceFile.getFunctions()) {
      if (!this.isExported(fn)) continue;
      const name = fn.getName();
      if (name) ids.push(this.buildSymbolId(filePath, name, 'function'));
    }
    for (const cls of sourceFile.getClasses()) {
      if (!this.isExported(cls)) continue;
      const name = cls.getName();
      if (name) ids.push(this.buildSymbolId(filePath, name, 'class'));
    }
    for (const iface of sourceFile.getInterfaces()) {
      if (!this.isExported(iface)) continue;
      ids.push(this.buildSymbolId(filePath, iface.getName(), 'interface'));
    }
    for (const t of sourceFile.getTypeAliases()) {
      if (!this.isExported(t)) continue;
      ids.push(this.buildSymbolId(filePath, t.getName(), 'type'));
    }
    for (const stmt of sourceFile.getVariableStatements()) {
      if (!this.isExported(stmt)) continue;
      for (const decl of stmt.getDeclarations()) {
        ids.push(this.buildSymbolId(filePath, decl.getName(), 'variable'));
      }
    }
    return ids;
  }

  private isExported(node: Node): boolean {
    if (Node.isExportable(node)) {
      return node.isExported();
    }
    return false;
  }

  private countCyclomaticComplexity(node: FunctionDeclaration | MethodDeclaration): number {
    let complexity = 1;

    node.forEachDescendant((child) => {
      switch (child.getKind()) {
        case SyntaxKind.IfStatement:
        case SyntaxKind.ConditionalExpression:
        case SyntaxKind.ForStatement:
        case SyntaxKind.ForInStatement:
        case SyntaxKind.ForOfStatement:
        case SyntaxKind.WhileStatement:
        case SyntaxKind.DoStatement:
        case SyntaxKind.CaseClause:
        case SyntaxKind.CatchClause:
        case SyntaxKind.BinaryExpression: {
          const text = child.getText();
          if (child.getKind() === SyntaxKind.BinaryExpression) {
            if (text.includes('&&') || text.includes('||') || text.includes('??')) {
              complexity++;
            }
          } else {
            complexity++;
          }
          break;
        }
      }
    });

    return complexity;
  }
}
