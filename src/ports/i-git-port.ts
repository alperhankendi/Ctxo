import type { CommitRecord, ChurnData } from '../core/types.js';

export interface IGitPort {
  getCommitHistory(filePath: string, maxCount?: number): Promise<CommitRecord[]>;
  getFileChurn(filePath: string): Promise<ChurnData>;
  getChangedFiles(since: string): Promise<string[]>;
  isAvailable(): Promise<boolean>;
}
