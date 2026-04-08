import { simpleGit, type SimpleGit } from 'simple-git';
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

  async getCommitHistory(filePath: string, maxCount?: number): Promise<CommitRecord[]> {
    try {
      const log = await this.git.log({
        file: filePath,
        '--follow': null,
        ...(maxCount ? { maxCount } : {}),
      });

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

  async getBatchHistory(maxCount = 20): Promise<Map<string, CommitRecord[]>> {
    try {
      const log = await this.git.log({ maxCount: maxCount * 50, '--name-only': null });
      const result = new Map<string, CommitRecord[]>();

      for (const entry of log.all) {
        const record: CommitRecord = {
          hash: entry.hash,
          message: entry.message,
          date: entry.date,
          author: entry.author_name,
        };

        const diff = entry.diff;
        const files: string[] = diff?.files?.map((f: { file: string }) => f.file.replace(/\\/g, '/')) ?? [];

        for (const file of files) {
          let list = result.get(file);
          if (!list) { list = []; result.set(file, list); }
          if (list.length < maxCount) {
            list.push(record);
          }
        }
      }

      return result;
    } catch (err) {
      console.error(`[ctxo:git] Batch history failed: ${(err as Error).message}`);
      return new Map();
    }
  }

  async getChangedFiles(since: string): Promise<string[]> {
    try {
      const diff = await this.git.diffSummary([since]);
      return diff.files.map((f) => f.file.replace(/\\/g, '/'));
    } catch (err) {
      console.error(`[ctxo:git] Failed to get changed files since ${since}: ${(err as Error).message}`);
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
