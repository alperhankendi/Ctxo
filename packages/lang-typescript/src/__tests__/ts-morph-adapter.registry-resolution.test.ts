import { describe, it, expect } from 'vitest';
import type { SymbolKind } from '@ctxo/plugin-api';
import { TsMorphAdapter } from '../ts-morph-adapter.js';

// Single-file runs (`ctxo index --files`, `--commit`, post-commit hook) never preload the
// target module into the ts-morph project, so relative specifiers must resolve through the
// symbol registry the CLI seeds from the committed index.

function registryOf(...ids: string[]): Map<string, SymbolKind> {
  const registry = new Map<string, SymbolKind>();
  for (const id of ids) {
    registry.set(id, id.split('::')[2] as SymbolKind);
  }
  return registry;
}

function adapterWith(...ids: string[]): TsMorphAdapter {
  const adapter = new TsMorphAdapter();
  adapter.setSymbolRegistry(registryOf(...ids));
  return adapter;
}

describe('TsMorphAdapter - registry resolution of relative specifiers (single-file runs)', () => {
  it('extends through an extensionless import resolves to the registered .ts class', async () => {
    const adapter = adapterWith('src/base.ts::Base::class');
    const source = `
      import { Base } from './base';
      export class Child extends Base {}
    `;
    const edges = await adapter.extractEdges('src/child.ts', source);

    const edge = edges.find((e) => e.kind === 'extends');
    expect(edge).toBeDefined();
    expect(edge!.from).toBe('src/child.ts::Child::class');
    expect(edge!.to).toBe('src/base.ts::Base::class');
  });

  it('implements through an extensionless import resolves to a .tsx interface', async () => {
    const adapter = adapterWith('src/shape.tsx::Shape::interface');
    const source = `
      import { Shape } from './shape';
      export class Circle implements Shape {}
    `;
    const edges = await adapter.extractEdges('src/circle.ts', source);

    const edge = edges.find((e) => e.kind === 'implements');
    expect(edge).toBeDefined();
    expect(edge!.to).toBe('src/shape.tsx::Shape::interface');
  });

  it('extends through a directory import resolves to index.ts', async () => {
    const adapter = adapterWith('src/models/index.ts::Base::class');
    const source = `
      import { Base } from './models';
      export class Child extends Base {}
    `;
    const edges = await adapter.extractEdges('src/child.ts', source);

    const edge = edges.find((e) => e.kind === 'extends');
    expect(edge).toBeDefined();
    expect(edge!.to).toBe('src/models/index.ts::Base::class');
  });

  it('extends through a directory import resolves to index.tsx', async () => {
    const adapter = adapterWith('src/views/index.tsx::View::class');
    const source = `
      import { View } from './views';
      export class Page extends View {}
    `;
    const edges = await adapter.extractEdges('src/page.ts', source);

    expect(edges.find((e) => e.kind === 'extends')!.to).toBe('src/views/index.tsx::View::class');
  });

  it('import edge to an extensionless .tsx module uses the registered kind', async () => {
    const adapter = adapterWith('src/Button.tsx::Button::function');
    const source = `
      import { Button } from './Button';
      export function render(): unknown { return Button; }
    `;
    const edges = await adapter.extractEdges('src/app.ts', source);

    const edge = edges.find((e) => e.kind === 'imports');
    expect(edge).toBeDefined();
    expect(edge!.to).toBe('src/Button.tsx::Button::function');
  });

  it('import edge to a directory import uses the registered index.ts symbol', async () => {
    const adapter = adapterWith('src/utils/index.ts::formatName::function');
    const source = `
      import { formatName } from './utils';
      export function greet(): string { return formatName('x'); }
    `;
    const edges = await adapter.extractEdges('src/app.ts', source);

    const imports = edges.filter((e) => e.kind === 'imports');
    expect(imports.map((e) => e.to)).toEqual(['src/utils/index.ts::formatName::function']);
    const calls = edges.filter((e) => e.kind === 'calls');
    expect(calls.map((e) => e.to)).toEqual(['src/utils/index.ts::formatName::function']);
  });

  it('no registry match keeps the previous fallback', async () => {
    const adapter = adapterWith('src/other.ts::Other::class');
    const source = `
      import { Base } from './base';
      export class Child extends Base {}
    `;
    const edges = await adapter.extractEdges('src/child.ts', source);

    const edge = edges.find((e) => e.kind === 'extends');
    expect(edge).toBeDefined();
    // the .ts candidate plus defaultKind, not the extensionless src/base::Base::class
    expect(edge!.to).toBe('src/base.ts::Base::class');
  });

  it('no registry match keeps the previous import edge fallback', async () => {
    const adapter = adapterWith();
    const source = `
      import { Thing } from './thing';
      export function use(): unknown { return Thing; }
    `;
    const edges = await adapter.extractEdges('src/use.ts', source);

    expect(edges.find((e) => e.kind === 'imports')!.to).toBe('src/thing.ts::Thing::class');
  });

  it('explicit .js import still resolves to the .ts file', async () => {
    const adapter = adapterWith();
    const source = `
      import { Base } from './base.js';
      export class Child extends Base {}
    `;
    const edges = await adapter.extractEdges('src/child.ts', source);

    expect(edges.find((e) => e.kind === 'extends')!.to).toBe('src/base.ts::Base::class');
    expect(edges.find((e) => e.kind === 'imports')!.to).toBe('src/base.ts::Base::class');
  });

  it('explicit .js import resolves to a registered .tsx file when no .ts exists', async () => {
    const adapter = adapterWith('src/base.tsx::Base::class');
    const source = `
      import { Base } from './base.js';
      export class Child extends Base {}
    `;
    const edges = await adapter.extractEdges('src/child.ts', source);

    expect(edges.find((e) => e.kind === 'extends')!.to).toBe('src/base.tsx::Base::class');
  });

  it('explicit .jsx import still resolves to the .tsx file', async () => {
    const adapter = adapterWith();
    const source = `
      import { Base } from './base.jsx';
      export class Child extends Base {}
    `;
    const edges = await adapter.extractEdges('src/child.ts', source);

    expect(edges.find((e) => e.kind === 'extends')!.to).toBe('src/base.tsx::Base::class');
  });

  it('explicit .ts specifier is kept as is', async () => {
    const adapter = adapterWith('src/base.ts::Base::class');
    const source = `
      import { Base } from './base.ts';
      export class Child extends Base {}
    `;
    const edges = await adapter.extractEdges('src/child.ts', source);

    expect(edges.find((e) => e.kind === 'extends')!.to).toBe('src/base.ts::Base::class');
  });

  it('extends takes the registered kind when it differs from the default', async () => {
    const adapter = adapterWith('src/mixin.ts::Mixin::variable');
    const source = `
      import { Mixin } from './mixin';
      export class Child extends Mixin {}
    `;
    const edges = await adapter.extractEdges('src/child.ts', source);

    expect(edges.find((e) => e.kind === 'extends')!.to).toBe('src/mixin.ts::Mixin::variable');
  });

  it('extends prefers the default kind when several kinds are registered', async () => {
    const adapter = adapterWith('src/base.ts::Base::interface', 'src/base.ts::Base::class');
    const source = `
      import { Base } from './base';
      export class Child extends Base {}
    `;
    const edges = await adapter.extractEdges('src/child.ts', source);

    expect(edges.find((e) => e.kind === 'extends')!.to).toBe('src/base.ts::Base::class');
  });

  it('prefers the .ts candidate over .tsx and index files', async () => {
    const adapter = adapterWith(
      'src/base/index.ts::Base::class',
      'src/base.tsx::Base::class',
      'src/base.ts::Base::class',
    );
    const source = `
      import { Base } from './base';
      export class Child extends Base {}
    `;
    const edges = await adapter.extractEdges('src/child.ts', source);

    expect(edges.find((e) => e.kind === 'extends')!.to).toBe('src/base.ts::Base::class');
  });

  it('resolves parent-directory specifiers against the importing file', async () => {
    const adapter = adapterWith('src/core/base.tsx::Base::class');
    const source = `
      import { Base } from '../core/base';
      export class Child extends Base {}
    `;
    const edges = await adapter.extractEdges('src/features/child.ts', source);

    expect(edges.find((e) => e.kind === 'extends')!.to).toBe('src/core/base.tsx::Base::class');
  });

  it('extensionless names containing dots resolve through the registry', async () => {
    const adapter = adapterWith('src/user.service.ts::UserService::class');
    const source = `
      import { UserService } from './user.service';
      export class Admin extends UserService {}
    `;
    const edges = await adapter.extractEdges('src/admin.ts', source);

    expect(edges.find((e) => e.kind === 'extends')!.to).toBe('src/user.service.ts::UserService::class');
    expect(edges.find((e) => e.kind === 'imports')!.to).toBe('src/user.service.ts::UserService::class');
  });

  it('does not match a registered file with a longer name sharing the prefix', async () => {
    const adapter = adapterWith('src/base-extra.ts::Base::class');
    const source = `
      import { Base } from './base';
      export class Child extends Base {}
    `;
    const edges = await adapter.extractEdges('src/child.ts', source);

    expect(edges.find((e) => e.kind === 'extends')!.to).toBe('src/base.ts::Base::class');
  });

  it('sees registry entries added after setSymbolRegistry', async () => {
    const registry = new Map<string, SymbolKind>();
    const adapter = new TsMorphAdapter();
    adapter.setSymbolRegistry(registry);
    const source = `
      import { Base } from './base';
      export class Child extends Base {}
    `;

    const before = await adapter.extractEdges('src/child.ts', source);
    expect(before.find((e) => e.kind === 'extends')!.to).toBe('src/base.ts::Base::class');

    registry.set('src/base.tsx::Base::class', 'class');
    const after = await adapter.extractEdges('src/child.ts', source);
    expect(after.find((e) => e.kind === 'extends')!.to).toBe('src/base.tsx::Base::class');
  });

  it('a preloaded project without a registry resolves .tsx and index imports to the real kind', async () => {
    const adapter = new TsMorphAdapter();
    const sources = new Map<string, string>([
      ['src/Button.tsx', 'export function Button(): unknown { return null; }'],
      ['src/utils/index.ts', 'export function formatName(n: string): string { return n; }'],
      [
        'src/app.ts',
        `import { Button } from './Button';
         import { formatName } from './utils';
         export function render(): unknown { return [Button, formatName('x')]; }`,
      ],
    ]);
    adapter.loadProjectSources(sources);

    const edges = await adapter.extractEdges('src/app.ts', sources.get('src/app.ts')!);
    const targets = edges.filter((e) => e.kind === 'imports').map((e) => e.to);

    expect(targets).toContain('src/Button.tsx::Button::function');
    expect(targets).toContain('src/utils/index.ts::formatName::function');

    adapter.clearProjectSources();
  });

  it('full run: extends resolves through the loaded project exactly as before', async () => {
    const adapter = new TsMorphAdapter();
    const sources = new Map<string, string>([
      ['src/base.ts', 'export class Base {}'],
      ['src/child.ts', `import { Base } from './base';\nexport class Child extends Base {}`],
    ]);
    adapter.loadProjectSources(sources);

    const edges = await adapter.extractEdges('src/child.ts', sources.get('src/child.ts')!);

    expect(edges.find((e) => e.kind === 'extends')!.to).toBe('src/base.ts::Base::class');

    adapter.clearProjectSources();
  });
});
