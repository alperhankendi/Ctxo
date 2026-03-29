export interface LayerRule {
  readonly pattern: RegExp;
  readonly layer: string;
}

export interface OverlayResult {
  readonly layers: Record<string, string[]>;
}

const DEFAULT_RULES: LayerRule[] = [
  // Test layer (matched first — __tests__, .test.ts, tests/, fixtures)
  { pattern: /__tests__/, layer: 'Test' },
  { pattern: /\.test\.ts$/, layer: 'Test' },
  { pattern: /\btests\b/, layer: 'Test' },
  { pattern: /\bfixtures?\b/, layer: 'Test' },
  // Composition root
  { pattern: /src\/index\.ts$/, layer: 'Composition' },
  // Domain
  { pattern: /\bcore\b/, layer: 'Domain' },
  { pattern: /\bports?\b/, layer: 'Domain' },
  // Adapter
  { pattern: /\badapters?\b/, layer: 'Adapter' },
  { pattern: /\bcli\b/, layer: 'Adapter' },
  // Infrastructure
  { pattern: /\binfra\b/, layer: 'Infrastructure' },
  { pattern: /\bdb\b/, layer: 'Infrastructure' },
  { pattern: /\bqueue\b/, layer: 'Infrastructure' },
  // Config files
  { pattern: /\.(config|rc)\.(ts|js|json)$/, layer: 'Configuration' },
];

export class ArchitecturalOverlay {
  private readonly rules: LayerRule[];

  constructor(customRules?: LayerRule[]) {
    this.rules = (customRules ?? DEFAULT_RULES).map(({ pattern, layer }) => ({
      pattern: new RegExp(pattern.source, pattern.flags),
      layer,
    }));
  }

  classify(filePaths: readonly string[]): OverlayResult {
    const layers: Record<string, string[]> = {};

    for (const filePath of filePaths) {
      const layer = this.matchLayer(filePath);
      const list = layers[layer] ?? [];
      list.push(filePath);
      layers[layer] = list;
    }

    return { layers };
  }

  private matchLayer(filePath: string): string {
    for (const rule of this.rules) {
      if (rule.pattern.test(filePath)) {
        return rule.layer;
      }
    }
    return 'Unknown';
  }
}
