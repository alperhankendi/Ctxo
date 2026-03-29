import { watch, type FSWatcher } from 'chokidar';
import type { IWatcherPort, FileChangeHandler } from '../../ports/i-watcher-port.js';

const DEFAULT_IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.ctxo/**',
  '**/dist/**',
  '**/coverage/**',
];

export class ChokidarWatcherAdapter implements IWatcherPort {
  private readonly projectRoot: string;
  private readonly ignored: string[];
  private watcher: FSWatcher | undefined;

  constructor(projectRoot: string, ignored?: string[]) {
    this.projectRoot = projectRoot;
    this.ignored = ignored ?? DEFAULT_IGNORED;
  }

  start(handler: FileChangeHandler): void {
    if (this.watcher) {
      throw new Error('Watcher already started. Call stop() before starting again.');
    }

    this.watcher = watch(this.projectRoot, {
      ignored: this.ignored,
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('add', (path) => handler('add', path));
    this.watcher.on('change', (path) => handler('change', path));
    this.watcher.on('unlink', (path) => handler('unlink', path));
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }
  }
}
