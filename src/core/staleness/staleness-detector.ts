import { statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface StalenessWarning {
  readonly staleFiles: string[];
  readonly message: string;
}

export class StalenessDetector {
  private readonly projectRoot: string;
  private readonly indexDir: string;

  constructor(projectRoot: string, ctxoRoot: string) {
    this.projectRoot = projectRoot;
    this.indexDir = join(ctxoRoot, 'index');
  }

  check(indexedFiles: readonly string[]): StalenessWarning | undefined {
    if (!existsSync(this.indexDir)) return undefined;

    const staleFiles: string[] = [];

    for (const relativePath of indexedFiles) {
      const sourcePath = join(this.projectRoot, relativePath);
      const indexPath = join(this.indexDir, `${relativePath}.json`);

      if (!existsSync(sourcePath) || !existsSync(indexPath)) continue;

      try {
        const sourceMtime = Math.floor(statSync(sourcePath).mtimeMs / 1000);
        const indexMtime = Math.floor(statSync(indexPath).mtimeMs / 1000);

        if (sourceMtime > indexMtime) {
          staleFiles.push(relativePath);
        }
      } catch {
        // Skip files we can't stat
      }
    }

    if (staleFiles.length === 0) return undefined;

    return {
      staleFiles,
      message: `Index may be stale for ${staleFiles.length} file(s). Run "ctxo index" to refresh.`,
    };
  }
}
