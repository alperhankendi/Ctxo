import { extname } from 'node:path';
import type { ILanguageAdapter } from '@ctxo/plugin-api';

export class LanguageAdapterRegistry {
  private readonly adaptersByExtension = new Map<string, ILanguageAdapter>();

  register(extensions: readonly string[], adapter: ILanguageAdapter): void {
    for (const ext of extensions) {
      this.adaptersByExtension.set(ext.toLowerCase(), adapter);
    }
  }

  getSupportedExtensions(): Set<string> {
    return new Set(this.adaptersByExtension.keys());
  }

  getAdapter(filePath: string): ILanguageAdapter | undefined {
    if (!filePath) return undefined;

    const ext = extname(filePath).toLowerCase();
    if (!ext) return undefined;

    return this.adaptersByExtension.get(ext);
  }
}
