import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Imported after the mock is registered.
const { runPackageManager } = await import('../run-package-manager.js');

function fakeChild(emit: (child: EventEmitter) => void): EventEmitter {
  const child = new EventEmitter();
  queueMicrotask(() => emit(child));
  return child;
}

const originalPlatform = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  spawnMock.mockReset();
});

describe('runPackageManager', () => {
  it('on win32 spawns a single shell command STRING (avoids EINVAL on .cmd shims and DEP0190)', async () => {
    setPlatform('win32');
    spawnMock.mockImplementation(() => fakeChild((c) => c.emit('exit', 0)));

    const code = await runPackageManager('npm', ['install', '-g', '@ctxo/lang-java'], 'C:\\proj');

    expect(code).toBe(0);
    const call = spawnMock.mock.calls[0];
    // Single string, NOT an argv array, so .cmd resolves via the shell.
    expect(call[0]).toBe('npm install -g @ctxo/lang-java');
    expect(call[1]).toMatchObject({ shell: true, cwd: 'C:\\proj', stdio: 'inherit' });
    // No argv array argument (would trigger DEP0190 with shell:true).
    expect(Array.isArray(call[1])).toBe(false);
  });

  it('on posix spawns command + argv array with shell:false', async () => {
    setPlatform('linux');
    spawnMock.mockImplementation(() => fakeChild((c) => c.emit('exit', 0)));

    const code = await runPackageManager('pnpm', ['add', '-D', '@ctxo/lang-go'], '/proj');

    expect(code).toBe(0);
    const [cmd, args, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe('pnpm');
    expect(args).toEqual(['add', '-D', '@ctxo/lang-go']);
    expect(opts).toMatchObject({ shell: false, cwd: '/proj', stdio: 'inherit' });
  });

  it('resolves with the exit code (non-zero preserved)', async () => {
    setPlatform('linux');
    spawnMock.mockImplementation(() => fakeChild((c) => c.emit('exit', 1)));
    await expect(runPackageManager('npm', ['install'], '/p')).resolves.toBe(1);
  });

  it('rejects when the child emits an error', async () => {
    setPlatform('linux');
    spawnMock.mockImplementation(() => fakeChild((c) => c.emit('error', new Error('boom'))));
    await expect(runPackageManager('npm', ['install'], '/p')).rejects.toThrow('boom');
  });
});
