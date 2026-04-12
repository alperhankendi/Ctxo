import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolvePackageManager,
  buildInstallCommand,
  isPackageManager,
  PACKAGE_MANAGERS,
} from '../package-manager.js';

describe('isPackageManager', () => {
  it('accepts supported managers', () => {
    for (const pm of PACKAGE_MANAGERS) {
      expect(isPackageManager(pm)).toBe(true);
    }
  });
  it('rejects unknown strings', () => {
    expect(isPackageManager('poetry')).toBe(false);
    expect(isPackageManager('')).toBe(false);
  });
});

describe('resolvePackageManager', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ctxo-pm-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('honors --pm flag above everything else', () => {
    writeFileSync(join(tmp, 'pnpm-lock.yaml'), '');
    const result = resolvePackageManager({ flag: 'yarn', projectRoot: tmp, env: { CTXO_PM: 'bun' } });
    expect(result).toEqual({ manager: 'yarn', source: 'flag' });
  });

  it('throws when --pm value is unsupported', () => {
    expect(() =>
      resolvePackageManager({ flag: 'poetry', projectRoot: tmp }),
    ).toThrow(/Unknown --pm value "poetry"/);
  });

  it('honors CTXO_PM env above config + lockfile', () => {
    writeFileSync(join(tmp, 'pnpm-lock.yaml'), '');
    const result = resolvePackageManager({ projectRoot: tmp, env: { CTXO_PM: 'bun' } });
    expect(result).toEqual({ manager: 'bun', source: 'env' });
  });

  it('throws when CTXO_PM is unsupported', () => {
    expect(() =>
      resolvePackageManager({ projectRoot: tmp, env: { CTXO_PM: 'poetry' } }),
    ).toThrow(/CTXO_PM="poetry"/);
  });

  it('reads packageManager from .ctxo/config.yaml when env unset', () => {
    mkdirSync(join(tmp, '.ctxo'));
    writeFileSync(join(tmp, '.ctxo', 'config.yaml'), 'packageManager: pnpm\n');
    const result = resolvePackageManager({ projectRoot: tmp, env: {} });
    expect(result).toEqual({ manager: 'pnpm', source: 'config' });
  });

  it('prefers bun.lockb above others when no higher-priority source set', () => {
    writeFileSync(join(tmp, 'bun.lockb'), '');
    writeFileSync(join(tmp, 'pnpm-lock.yaml'), '');
    writeFileSync(join(tmp, 'yarn.lock'), '');
    writeFileSync(join(tmp, 'package-lock.json'), '{}');
    const result = resolvePackageManager({ projectRoot: tmp, env: {} });
    expect(result.manager).toBe('bun');
    expect(result.source).toBe('lockfile');
    expect(result.detail).toBe('bun.lockb');
  });

  it('falls back to npm when no signals exist', () => {
    const result = resolvePackageManager({ projectRoot: tmp, env: {} });
    expect(result).toEqual({ manager: 'npm', source: 'default' });
  });

  it('picks pnpm from pnpm-lock.yaml', () => {
    writeFileSync(join(tmp, 'pnpm-lock.yaml'), '');
    const result = resolvePackageManager({ projectRoot: tmp, env: {} });
    expect(result.manager).toBe('pnpm');
    expect(result.source).toBe('lockfile');
  });

  it('picks yarn from yarn.lock', () => {
    writeFileSync(join(tmp, 'yarn.lock'), '');
    const result = resolvePackageManager({ projectRoot: tmp, env: {} });
    expect(result.manager).toBe('yarn');
  });
});

describe('buildInstallCommand', () => {
  it('npm local install -D', () => {
    const inv = buildInstallCommand('npm', ['@ctxo/lang-python']);
    expect(inv).toEqual({ command: 'npm', args: ['install', '-D', '@ctxo/lang-python'] });
  });

  it('npm global install -g', () => {
    const inv = buildInstallCommand('npm', ['@ctxo/lang-python'], { global: true });
    expect(inv).toEqual({ command: 'npm', args: ['install', '-g', '@ctxo/lang-python'] });
  });

  it('pnpm add -D / global add -g', () => {
    expect(buildInstallCommand('pnpm', ['@ctxo/lang-python'])).toEqual({
      command: 'pnpm',
      args: ['add', '-D', '@ctxo/lang-python'],
    });
    expect(buildInstallCommand('pnpm', ['@ctxo/lang-python'], { global: true })).toEqual({
      command: 'pnpm',
      args: ['add', '-g', '@ctxo/lang-python'],
    });
  });

  it('yarn add --dev / yarn global add', () => {
    expect(buildInstallCommand('yarn', ['@ctxo/lang-python'])).toEqual({
      command: 'yarn',
      args: ['add', '--dev', '@ctxo/lang-python'],
    });
    expect(buildInstallCommand('yarn', ['@ctxo/lang-python'], { global: true })).toEqual({
      command: 'yarn',
      args: ['global', 'add', '@ctxo/lang-python'],
    });
  });

  it('bun add -d / -g', () => {
    expect(buildInstallCommand('bun', ['@ctxo/lang-python'])).toEqual({
      command: 'bun',
      args: ['add', '-d', '@ctxo/lang-python'],
    });
    expect(buildInstallCommand('bun', ['@ctxo/lang-python'], { global: true })).toEqual({
      command: 'bun',
      args: ['add', '-g', '@ctxo/lang-python'],
    });
  });

  it('accepts multiple packages', () => {
    const inv = buildInstallCommand('npm', ['@ctxo/lang-python', '@ctxo/lang-java']);
    expect(inv.args).toContain('@ctxo/lang-python');
    expect(inv.args).toContain('@ctxo/lang-java');
  });

  it('throws when no packages provided', () => {
    expect(() => buildInstallCommand('npm', [])).toThrow(/at least one package/);
  });
});
