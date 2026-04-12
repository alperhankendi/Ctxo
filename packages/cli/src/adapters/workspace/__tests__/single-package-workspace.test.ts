import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { detectWorkspace } from '../single-package-workspace.js';

describe('detectWorkspace', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ctxo-ws-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns a single-package workspace with root set to the resolved cwd', () => {
    const ws = detectWorkspace(tmp);
    expect(ws.root).toBe(resolve(tmp));
    expect(ws.packages).toHaveLength(1);
    expect(ws.packages[0]!.root).toBe(resolve(tmp));
  });

  it('picks package.json when present', () => {
    writeFileSync(join(tmp, 'package.json'), '{"name":"x"}');
    const ws = detectWorkspace(tmp);
    expect(ws.packages[0]!.manifest).toBe(join(resolve(tmp), 'package.json'));
  });

  it('prefers package.json over pyproject.toml when both exist', () => {
    writeFileSync(join(tmp, 'package.json'), '{"name":"x"}');
    writeFileSync(join(tmp, 'pyproject.toml'), '[project]');
    const ws = detectWorkspace(tmp);
    expect(ws.packages[0]!.manifest.endsWith('package.json')).toBe(true);
  });

  it('falls back to pyproject.toml for a python-only project', () => {
    writeFileSync(join(tmp, 'pyproject.toml'), '[project]');
    const ws = detectWorkspace(tmp);
    expect(ws.packages[0]!.manifest.endsWith('pyproject.toml')).toBe(true);
  });

  it('falls back to pom.xml for a java project', () => {
    writeFileSync(join(tmp, 'pom.xml'), '<project/>');
    const ws = detectWorkspace(tmp);
    expect(ws.packages[0]!.manifest.endsWith('pom.xml')).toBe(true);
  });

  it('falls back to go.mod for a go project', () => {
    writeFileSync(join(tmp, 'go.mod'), 'module example.com/x');
    const ws = detectWorkspace(tmp);
    expect(ws.packages[0]!.manifest.endsWith('go.mod')).toBe(true);
  });

  it('detects .csproj when no other manifest present', () => {
    writeFileSync(join(tmp, 'App.csproj'), '<Project/>');
    const ws = detectWorkspace(tmp);
    expect(ws.packages[0]!.manifest.endsWith('.csproj')).toBe(true);
  });

  it('defaults manifest to package.json path when nothing exists (even if file missing)', () => {
    const ws = detectWorkspace(tmp);
    expect(ws.packages[0]!.manifest).toBe(join(resolve(tmp), 'package.json'));
  });

  it('resolves relative inputs to absolute paths', () => {
    const ws = detectWorkspace(tmp);
    expect(ws.root.startsWith('/') || /^[A-Z]:\\/.test(ws.root)).toBe(true);
  });
});
