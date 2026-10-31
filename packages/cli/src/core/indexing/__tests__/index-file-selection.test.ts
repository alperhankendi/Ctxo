import { describe, expect, it } from 'vitest';
import { resolveWorkspaceRoots, selectIndexFiles, type WorkspaceView } from '../index-file-selection.js';

function view(packageJson: unknown, folders: Record<string, string[]>): WorkspaceView {
  return {
    packageJson: packageJson === undefined ? undefined : typeof packageJson === 'string' ? packageJson : JSON.stringify(packageJson),
    subdirectories: (dir) => folders[dir] ?? [],
    directoryExists: (dir) => dir === '' || dir in folders || Object.values(folders).some((names) => names.some((n) => dir.endsWith(`/${n}`) || dir === n)),
  };
}

const none = (): boolean => false;

describe('resolveWorkspaceRoots', () => {
  it('is the project root without package.json, without workspaces or with an unparsable one', () => {
    for (const pkg of [undefined, { name: 'x' }, { workspaces: [] }, '{ not json']) {
      expect(resolveWorkspaceRoots(view(pkg, {}), none)).toEqual({ kept: [''], ignored: [], monorepo: false });
    }
  });

  it('lists dir/* subfolders and literal folders, in workspace order, and drops ignored projects', () => {
    const roots = resolveWorkspaceRoots(
      view({ workspaces: { packages: ['packages/*', 'tools/cli/', './missing'] } }, { packages: ['b', 'a'], 'tools/cli': [] }),
      (dir) => dir === 'packages/b',
    );
    expect(roots).toEqual({ kept: ['packages/a', 'tools/cli'], ignored: ['packages/b'], monorepo: true });
  });

  it('falls back to the root when every workspace is ignored', () => {
    expect(resolveWorkspaceRoots(view({ workspaces: ['packages/*'] }, { packages: ['a'] }), () => true)).toEqual({
      kept: [''],
      ignored: ['packages/a'],
      monorepo: false,
    });
  });
});

describe('selectIndexFiles', () => {
  it('keeps files inside a kept folder with a supported extension and not ignored, sorted and unique', () => {
    const files = ['vitest.config.ts', 'packages/a/src/b.TS', 'packages/a/src/a.ts', 'packages/a/README.md', 'packages/ab/x.ts', 'packages/a/gen/g.ts'];
    const selected = selectIndexFiles([...files, 'packages/a/src/a.ts'], ['packages/a'], (ext) => ext === '.ts', (p) => p.includes('/gen/'));
    expect(selected).toEqual(['packages/a/src/a.ts', 'packages/a/src/b.TS']);
    expect(selectIndexFiles(files, [''], (ext) => ext === '.ts', none)).toContain('vitest.config.ts');
  });
});
