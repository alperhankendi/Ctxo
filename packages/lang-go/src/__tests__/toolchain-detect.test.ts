import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { detectGoToolchain } from '../analyzer/toolchain-detect.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExec = vi.mocked(execFileSync);

describe('detectGoToolchain', () => {
  beforeEach(() => {
    mockedExec.mockReset();
  });

  it('parses a normal `go version` line', () => {
    mockedExec.mockReturnValueOnce('go version go1.24.4 windows/amd64\n');
    const got = detectGoToolchain();
    expect(got.available).toBe(true);
    expect(got.version).toBe('1.24.4');
  });

  it('parses a two-segment version', () => {
    mockedExec.mockReturnValueOnce('go version go1.22 linux/amd64\n');
    const got = detectGoToolchain();
    expect(got.available).toBe(true);
    expect(got.version).toBe('1.22');
  });

  it('rejects versions below the 1.22 minimum', () => {
    mockedExec.mockReturnValueOnce('go version go1.21.5 darwin/arm64\n');
    const got = detectGoToolchain();
    expect(got.available).toBe(false);
    expect(got.version).toBe('1.21.5');
  });

  it('returns unavailable on unparseable output', () => {
    mockedExec.mockReturnValueOnce('something completely unexpected\n');
    expect(detectGoToolchain()).toEqual({ available: false });
  });

  it('returns unavailable when go is not on PATH (throws)', () => {
    mockedExec.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    expect(detectGoToolchain()).toEqual({ available: false });
  });
});
