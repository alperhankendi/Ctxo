import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { IndexCommand } from './index-command.js';

export class VerifyCommand {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async run(): Promise<void> {
    console.error('[ctxo] Verifying index freshness...');

    // Rebuild index to get current state
    const indexCmd = new IndexCommand(this.projectRoot);
    await indexCmd.run();

    // Check if committed index matches regenerated index
    const indexDir = join(this.projectRoot, '.ctxo', 'index');
    try {
      execFileSync('git', ['diff', '--exit-code', indexDir], {
        cwd: this.projectRoot,
        stdio: 'ignore',
      });

      console.error('[ctxo] Index is up to date');
    } catch {
      console.error('[ctxo] Index is STALE — source changes not reflected in committed index');
      console.error('[ctxo] Run "ctxo index" and commit the updated .ctxo/index/ directory');
      process.exit(1);
    }
  }
}
