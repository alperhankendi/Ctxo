export interface LayerRule {
  readonly pattern: RegExp;
  readonly layer: string;
}

export interface OverlayResult {
  readonly layers: Record<string, string[]>;
}

const DEFAULT_RULES: LayerRule[] = [
  { pattern: /\bcore\b/, layer: 'Domain' },
  { pattern: /\bports?\b/, layer: 'Domain' },
  { pattern: /\badapters?\b/, layer: 'Adapter' },
  { pattern: /\binfra\b/, layer: 'Infrastructure' },
  { pattern: /\bdb\b/, layer: 'Infrastructure' },
  { pattern: /\bqueue\b/, layer: 'Infrastructure' },
  { pattern: /\bcli\b/, layer: 'Adapter' },
];

export class ArchitecturalOverlay {
  private readonly rules: LayerRule[];

  constructor(customRules?: LayerRule[]) {
    this.rules = customRules ?? DEFAULT_RULES;
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
