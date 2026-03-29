import simpleGit, { type SimpleGit } from 'simple-git';
import type { IGitPort } from '../../ports/i-git-port.js';
import type { CommitRecord, ChurnData } from '../../core/types.js';

export class SimpleGitAdapter implements IGitPort {
  private readonly git: SimpleGit;

  constructor(projectRoot: string) {
    this.git = simpleGit(projectRoot);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.git.version();
      return true;
    } catch {
      return false;
    }
  }

  async getCommitHistory(filePath: string): Promise<CommitRecord[]> {
    try {
      const log = await this.git.log({ file: filePath, '--follow': null });

      return log.all.map((entry) => ({
        hash: entry.hash,
        message: entry.message,
        date: entry.date,
        author: entry.author_name,
      }));
    } catch (err) {
      console.error(`[ctxo:git] Failed to get history for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  async getFileChurn(filePath: string): Promise<ChurnData> {
    try {
      const log = await this.git.log({ file: filePath, '--follow': null });

      return {
        filePath,
        commitCount: log.total,
      };
    } catch (err) {
      console.error(`[ctxo:git] Failed to get churn for ${filePath}: ${(err as Error).message}`);
      return { filePath, commitCount: 0 };
    }
  }
}
