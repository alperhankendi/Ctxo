import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { FileIndex, GraphEdge, SymbolNode } from '../../core/types.js';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import { JsonIndexReader } from './json-index-reader.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger('ctxo:storage');

export class SqliteStorageAdapter implements IStoragePort {
  private db: Database | undefined;
  private readonly dbPath: string;
  private readonly ctxoRoot: string;

  constructor(ctxoRoot: string) {
    this.ctxoRoot = ctxoRoot;
    this.dbPath = join(ctxoRoot, '.cache', 'symbols.db');
  }

  async init(): Promise<void> {
    const SQL = await initSqlJs();

    if (existsSync(this.dbPath)) {
      try {
        const buffer = readFileSync(this.dbPath);
        this.db = new SQL.Database(buffer);
        this.verifyIntegrity();
      } catch {
        log.warn('Corrupt DB detected, rebuilding from JSON index');
        this.db = new SQL.Database();
        this.createTables();
      }
    } else {
      this.db = new SQL.Database();
      this.createTables();
    }

    // Always rebuild from JSON — it is the source of truth
    this.rebuildFromJson();
  }

  async initEmpty(): Promise<void> {
    const SQL = await initSqlJs();
    this.db = new SQL.Database();
    this.createTables();
  }

  private database(): Database {
    if (!this.db) {
      throw new Error('SqliteStorageAdapter not initialized. Call init() first.');
    }
    return this.db;
  }

  private verifyIntegrity(): void {
    const db = this.database();
    const result = db.exec('PRAGMA integrity_check');
    const firstRow = result[0]?.values[0];
    if (!firstRow || firstRow[0] !== 'ok') {
      throw new Error('SQLite integrity check failed');
    }

    const tables = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('symbols', 'edges', 'files')",
    );
    if (!tables[0] || tables[0].values.length < 3) {
      throw new Error('Missing required tables');
    }
  }

  private createTables(): void {
    const db = this.database();
    db.run(`
      CREATE TABLE IF NOT EXISTS files (
        file_path TEXT PRIMARY KEY,
        last_modified INTEGER NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS symbols (
        symbol_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_symbol TEXT NOT NULL,
        to_symbol TEXT NOT NULL,
        kind TEXT NOT NULL
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path)');
    db.run('CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_symbol)');
    db.run('CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_symbol)');
  }

  private rebuildFromJson(): void {
    const reader = new JsonIndexReader(this.ctxoRoot);
    const indices = reader.readAll();

    if (indices.length > 0) {
      this.bulkWrite(indices);
    }
  }

  writeSymbolFile(fileIndex: FileIndex): void {
    const db = this.database();

    db.run('BEGIN TRANSACTION');
    try {
      this.deleteFileData(db, fileIndex.file);

      db.run(
        'INSERT INTO files (file_path, last_modified) VALUES (?, ?)',
        [fileIndex.file, fileIndex.lastModified],
      );

      for (const sym of fileIndex.symbols) {
        db.run(
          'INSERT OR REPLACE INTO symbols (symbol_id, name, kind, file_path, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)',
          [sym.symbolId, sym.name, sym.kind, fileIndex.file, sym.startLine, sym.endLine],
        );
      }

      for (const edge of fileIndex.edges) {
        db.run(
          'INSERT INTO edges (from_symbol, to_symbol, kind) VALUES (?, ?, ?)',
          [edge.from, edge.to, edge.kind],
        );
      }

      db.run('COMMIT');
      this.persistIfNeeded();
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }
  }

  /**
   * Read symbol file from SQLite cache.
   * NOTE: SQLite only caches symbols + edges (graph topology).
   * intent, antiPatterns, and complexity live in committed JSON index only.
   * Use JsonIndexReader for full FileIndex data.
   */
  readSymbolFile(relativePath: string): FileIndex | undefined {
    const db = this.database();

    const fileResult = db.exec(
      'SELECT file_path, last_modified FROM files WHERE file_path = ?',
      [relativePath],
    );
    if (!fileResult[0] || fileResult[0].values.length === 0) {
      return undefined;
    }

    const [filePath, lastModified] = fileResult[0].values[0] as [string, number];

    const symbols = this.getSymbolsForFile(db, filePath);
    const edges = this.getEdgesForFile(db, filePath);

    return {
      file: filePath,
      lastModified,
      symbols,
      edges,
      // Not stored in SQLite — use JsonIndexReader for these fields
      intent: [],
      antiPatterns: [],
    };
  }

  listIndexedFiles(): string[] {
    const db = this.database();
    const result = db.exec('SELECT file_path FROM files ORDER BY file_path');
    if (!result[0]) return [];
    return result[0].values.map((row) => row[0] as string);
  }

  deleteSymbolFile(relativePath: string): void {
    const db = this.database();
    this.deleteFileData(db, relativePath);
  }

  getSymbolById(symbolId: string): SymbolNode | undefined {
    const db = this.database();
    const result = db.exec(
      'SELECT symbol_id, name, kind, start_line, end_line FROM symbols WHERE symbol_id = ?',
      [symbolId],
    );
    if (!result[0] || result[0].values.length === 0) {
      return undefined;
    }

    const [sid, name, kind, startLine, endLine] = result[0].values[0] as [string, string, string, number, number];
    return { symbolId: sid, name, kind: kind as SymbolNode['kind'], startLine, endLine };
  }

  getEdgesFrom(symbolId: string): GraphEdge[] {
    const db = this.database();
    const result = db.exec(
      'SELECT from_symbol, to_symbol, kind FROM edges WHERE from_symbol = ?',
      [symbolId],
    );
    if (!result[0]) return [];
    return result[0].values.map((row) => ({
      from: row[0] as string,
      to: row[1] as string,
      kind: row[2] as GraphEdge['kind'],
    }));
  }

  getEdgesTo(symbolId: string): GraphEdge[] {
    const db = this.database();
    const result = db.exec(
      'SELECT from_symbol, to_symbol, kind FROM edges WHERE to_symbol = ?',
      [symbolId],
    );
    if (!result[0]) return [];
    return result[0].values.map((row) => ({
      from: row[0] as string,
      to: row[1] as string,
      kind: row[2] as GraphEdge['kind'],
    }));
  }

  getAllSymbols(): SymbolNode[] {
    const db = this.database();
    const result = db.exec(
      'SELECT symbol_id, name, kind, start_line, end_line FROM symbols',
    );
    if (!result[0]) return [];
    return result[0].values.map((row) => ({
      symbolId: row[0] as string,
      name: row[1] as string,
      kind: row[2] as SymbolNode['kind'],
      startLine: row[3] as number,
      endLine: row[4] as number,
    }));
  }

  getAllEdges(): GraphEdge[] {
    const db = this.database();
    const result = db.exec(
      'SELECT from_symbol, to_symbol, kind FROM edges',
    );
    if (!result[0]) return [];
    return result[0].values.map((row) => ({
      from: row[0] as string,
      to: row[1] as string,
      kind: row[2] as GraphEdge['kind'],
    }));
  }

  bulkWrite(indices: FileIndex[]): void {
    const db = this.database();

    db.run('BEGIN TRANSACTION');
    try {
      for (const fileIndex of indices) {
        this.deleteFileData(db, fileIndex.file);

        db.run(
          'INSERT INTO files (file_path, last_modified) VALUES (?, ?)',
          [fileIndex.file, fileIndex.lastModified],
        );

        for (const sym of fileIndex.symbols) {
          db.run(
            'INSERT OR REPLACE INTO symbols (symbol_id, name, kind, file_path, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)',
            [sym.symbolId, sym.name, sym.kind, fileIndex.file, sym.startLine, sym.endLine],
          );
        }

        for (const edge of fileIndex.edges) {
          db.run(
            'INSERT INTO edges (from_symbol, to_symbol, kind) VALUES (?, ?, ?)',
            [edge.from, edge.to, edge.kind],
          );
        }
      }

      db.run('COMMIT');
      this.persistIfNeeded();
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }
  }

  persist(): void {
    const db = this.database();
    const data = db.export();
    const buffer = Buffer.from(data);
    mkdirSync(dirname(this.dbPath), { recursive: true });
    writeFileSync(this.dbPath, buffer);
  }

  close(): void {
    if (this.db) {
      this.persist();
      this.db.close();
      this.db = undefined;
    }
  }

  private persistIfNeeded(): void {
    try {
      this.persist();
    } catch (err) {
      log.error(`Failed to persist DB: ${(err as Error).message}`);
    }
  }

  private deleteFileData(db: Database, filePath: string): void {
    // Delete edges originating from this file's symbols
    const symResult = db.exec(
      'SELECT symbol_id FROM symbols WHERE file_path = ?',
      [filePath],
    );
    if (symResult[0]) {
      for (const row of symResult[0].values) {
        db.run('DELETE FROM edges WHERE from_symbol = ?', [row[0]]);
      }
    }
    db.run('DELETE FROM symbols WHERE file_path = ?', [filePath]);
    db.run('DELETE FROM files WHERE file_path = ?', [filePath]);
  }

  private getSymbolsForFile(db: Database, filePath: string): SymbolNode[] {
    const result = db.exec(
      'SELECT symbol_id, name, kind, start_line, end_line FROM symbols WHERE file_path = ? ORDER BY start_line',
      [filePath],
    );
    if (!result[0]) return [];
    return result[0].values.map((row) => ({
      symbolId: row[0] as string,
      name: row[1] as string,
      kind: row[2] as SymbolNode['kind'],
      startLine: row[3] as number,
      endLine: row[4] as number,
    }));
  }

  private getEdgesForFile(db: Database, filePath: string): GraphEdge[] {
    const result = db.exec(
      `SELECT e.from_symbol, e.to_symbol, e.kind FROM edges e
       INNER JOIN symbols s ON e.from_symbol = s.symbol_id
       WHERE s.file_path = ?`,
      [filePath],
    );
    if (!result[0]) return [];
    return result[0].values.map((row) => ({
      from: row[0] as string,
      to: row[1] as string,
      kind: row[2] as GraphEdge['kind'],
    }));
  }
}
