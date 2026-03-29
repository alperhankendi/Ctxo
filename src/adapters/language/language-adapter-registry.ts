import { extname } from 'node:path';
import type { ILanguageAdapter } from '../../ports/i-language-adapter.js';

export class LanguageAdapterRegistry {
  private readonly adaptersByExtension = new Map<string, ILanguageAdapter>();

  register(adapter: ILanguageAdapter): void {
    for (const ext of adapter.extensions) {
      this.adaptersByExtension.set(ext.toLowerCase(), adapter);
    }
  }

  getAdapter(filePath: string): ILanguageAdapter | undefined {
    if (!filePath) return undefined;

    const ext = extname(filePath).toLowerCase();
    if (!ext) return undefined;

    return this.adaptersByExtension.get(ext);
  }
}
