import {
  Project,
  SyntaxKind,
  Node,
  type SourceFile,
  type FunctionDeclaration,
  type MethodDeclaration,
  ScriptTarget,
} from 'ts-morph';
import { extname } from 'node:path';
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind } from '../../core/types.js';
import type { ILanguageAdapter } from '../../ports/i-language-adapter.js';

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

export class TsMorphAdapter implements ILanguageAdapter {
  readonly extensions = SUPPORTED_EXTENSIONS;
  readonly tier = 'full' as const;

  private readonly project: Project;

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
    // Compute once per file, not per import declaration
    const fileSymbolId = this.buildSymbolId(filePath, sourceFile.getBaseName().replace(/\.[^.]+$/, ''), 'variable');
    const fromSymbols = this.findExportedSymbolsInFile(filePath);
    const fromSymbol = fromSymbols.length > 0 ? fromSymbols[0]! : fileSymbolId;

    for (const imp of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = imp.getModuleSpecifierValue();

      // Only track local imports (relative paths)
      if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) {
        continue;
      }

      const resolvedSourceFile = imp.getModuleSpecifierSourceFile();
      const targetFile = resolvedSourceFile?.getFilePath() ?? moduleSpecifier;
      const normalizedTarget = this.normalizeFilePath(targetFile);

      for (const named of imp.getNamedImports()) {
        const importedName = named.getName();

        edges.push({
          from: fromSymbol,
          to: this.resolveImportTarget(normalizedTarget, importedName),
          kind: 'imports',
        });
      }

      const defaultImport = imp.getDefaultImport();
      if (defaultImport) {

        edges.push({
          from: fromSymbol,
          to: this.resolveImportTarget(normalizedTarget, defaultImport.getText()),
          kind: 'imports',
        });
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
        const baseName = baseClass.getExpression().getText();
        edges.push({
          from: classSymbolId,
          to: this.resolveSymbolReference(sourceFile, baseName, 'class'),
          kind: 'extends',
        });
      }

      // implements
      for (const impl of cls.getImplements()) {
        const ifaceName = impl.getExpression().getText();
        edges.push({
          from: classSymbolId,
          to: this.resolveSymbolReference(sourceFile, ifaceName, 'interface'),
          kind: 'implements',
        });
      }
    }
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

  private resolveImportTarget(targetFile: string, name: string): string {
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
    // Fallback: use function as default kind (most common for imports)
    return `${targetFile}::${name}::function`;
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
          const targetFile = imp.getModuleSpecifierSourceFile()?.getFilePath() ?? moduleSpecifier;
          return `${this.normalizeFilePath(targetFile)}::${name}::${defaultKind}`;
        }
      }
    }

    // Assume it's in the same file
    return `${sourceFile.getFilePath()}::${name}::${defaultKind}`;
  }

  private normalizeFilePath(filePath: string): string {
    // Remove leading / from in-memory file system paths
    return filePath.replace(/^\//, '');
  }

  private findExportedSymbolsInFile(filePath: string): string[] {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return [];

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
