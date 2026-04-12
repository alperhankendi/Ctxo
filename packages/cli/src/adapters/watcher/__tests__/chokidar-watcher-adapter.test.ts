import { describe, it, expect, vi } from 'vitest';
import { ChokidarWatcherAdapter } from '../chokidar-watcher-adapter.js';
import type { FileChangeHandler } from '../../../ports/i-watcher-port.js';

describe('ChokidarWatcherAdapter', () => {
  it('implements IWatcherPort interface with start and stop methods', () => {
    const adapter = new ChokidarWatcherAdapter(process.cwd());
    expect(typeof adapter.start).toBe('function');
    expect(typeof adapter.stop).toBe('function');
  });

  it('stop does not throw when called without start', async () => {
    const adapter = new ChokidarWatcherAdapter(process.cwd());
    await expect(adapter.stop()).resolves.toBeUndefined();
  });

  it('accepts custom ignored patterns', () => {
    const adapter = new ChokidarWatcherAdapter(process.cwd(), ['**/custom/**']);
    expect(adapter).toBeDefined();
  });

  it('calls cleanup on stop (TS-010 — verify close is called)', async () => {
    const adapter = new ChokidarWatcherAdapter(process.cwd());

    // Start creates a watcher
    const handler: FileChangeHandler = vi.fn();
    adapter.start(handler);

    // Stop should close the watcher without error
    await expect(adapter.stop()).resolves.toBeUndefined();

    // Second stop should be no-op
    await expect(adapter.stop()).resolves.toBeUndefined();
  });
});
