import type {
  CommunitySnapshot,
  FileIndex,
  GraphEdge,
  SymbolNode,
} from '../core/types.js';

export interface IStoragePort {
  writeSymbolFile(fileIndex: FileIndex): void;
  readSymbolFile(relativePath: string): FileIndex | undefined;
  listIndexedFiles(): string[];
  deleteSymbolFile(relativePath: string): void;
  getSymbolById(symbolId: string): SymbolNode | undefined;
  getEdgesFrom(symbolId: string): GraphEdge[];
  getEdgesTo(symbolId: string): GraphEdge[];
  getAllSymbols(): SymbolNode[];
  getAllEdges(): GraphEdge[];
  bulkWrite(indices: FileIndex[]): void;
  readCommunities(): CommunitySnapshot | undefined;
  writeCommunities(snapshot: CommunitySnapshot): void;
  listCommunityHistory(limit?: number): CommunitySnapshot[];
  close(): void;
}
