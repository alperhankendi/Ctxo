import { describe, it, expect } from 'vitest';
import { ArchitecturalOverlay } from '../architectural-overlay.js';

describe('ArchitecturalOverlay', () => {
  const overlay = new ArchitecturalOverlay();

  it('classifies core/ files as "Domain" layer', () => {
    const result = overlay.classify(['src/core/graph/symbol-graph.ts']);
    expect(result.layers['Domain']).toContain('src/core/graph/symbol-graph.ts');
  });

  it('classifies adapters/ files as "Adapter" layer', () => {
    const result = overlay.classify(['src/adapters/storage/sqlite.ts']);
    expect(result.layers['Adapter']).toContain('src/adapters/storage/sqlite.ts');
  });

  it('classifies infra/ files as "Infrastructure" layer', () => {
    const result = overlay.classify(['src/infra/queue-worker.ts']);
    expect(result.layers['Infrastructure']).toContain('src/infra/queue-worker.ts');
  });

  it('classifies db/ files as "Infrastructure" layer', () => {
    const result = overlay.classify(['src/db/migrations.ts']);
    expect(result.layers['Infrastructure']).toContain('src/db/migrations.ts');
  });

  it('classifies unknown paths as "Unknown" layer', () => {
    const result = overlay.classify(['src/utils/helpers.ts']);
    expect(result.layers['Unknown']).toContain('src/utils/helpers.ts');
  });

  it('applies custom configurable rules', () => {
    const custom = new ArchitecturalOverlay([
      { pattern: /services/, layer: 'Service' },
    ]);
    const result = custom.classify(['src/services/user-service.ts']);
    expect(result.layers['Service']).toContain('src/services/user-service.ts');
  });

  it('returns all layers with file lists', () => {
    const result = overlay.classify([
      'src/core/types.ts',
      'src/adapters/mcp/handler.ts',
      'src/utils/format.ts',
    ]);
    expect(Object.keys(result.layers).length).toBeGreaterThanOrEqual(2);
  });

  it('handles empty file list', () => {
    const result = overlay.classify([]);
    expect(result.layers).toEqual({});
  });

  it('handles flat project structure (mostly Unknown)', () => {
    const result = overlay.classify(['main.ts', 'server.ts']);
    expect(result.layers['Unknown']).toHaveLength(2);
  });

  it('classifies cli/ files as "Adapter" layer', () => {
    const result = overlay.classify(['src/cli/index-command.ts']);
    expect(result.layers['Adapter']).toContain('src/cli/index-command.ts');
  });

  it('classifies ports/ files as "Domain" layer', () => {
    const result = overlay.classify(['src/ports/i-storage-port.ts']);
    expect(result.layers['Domain']).toContain('src/ports/i-storage-port.ts');
  });

  it('classifies src/index.ts as "Composition" layer', () => {
    const result = overlay.classify(['src/index.ts']);
    expect(result.layers['Composition']).toContain('src/index.ts');
  });

  it('classifies __tests__ files as "Test" layer', () => {
    const result = overlay.classify(['src/core/__tests__/types.test.ts']);
    expect(result.layers['Test']).toContain('src/core/__tests__/types.test.ts');
  });

  it('classifies config files as "Configuration" layer', () => {
    const result = overlay.classify(['vitest.config.ts', 'eslint.config.js']);
    expect(result.layers['Configuration']).toHaveLength(2);
  });
});
