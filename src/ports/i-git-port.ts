import type { CommitRecord, ChurnData } from '../core/types.js';

export interface IGitPort {
  getCommitHistory(filePath: string): Promise<CommitRecord[]>;
  getFileChurn(filePath: string): Promise<ChurnData>;
  isAvailable(): Promise<boolean>;
}
