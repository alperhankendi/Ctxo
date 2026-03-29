import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const CURRENT_SCHEMA_VERSION = '1.0.0';

export class SchemaManager {
  private readonly versionFilePath: string;

  constructor(ctxoRoot: string) {
    this.versionFilePath = join(ctxoRoot, 'index', 'schema-version');
  }

  currentVersion(): string {
    return CURRENT_SCHEMA_VERSION;
  }

  readStoredVersion(): string | undefined {
    if (!existsSync(this.versionFilePath)) {
      return undefined;
    }
    return readFileSync(this.versionFilePath, 'utf-8').trim();
  }

  writeVersion(): void {
    mkdirSync(dirname(this.versionFilePath), { recursive: true });
    writeFileSync(this.versionFilePath, CURRENT_SCHEMA_VERSION, 'utf-8');
  }

  isCompatible(): boolean {
    const stored = this.readStoredVersion();
    if (!stored) return false;
    return stored === CURRENT_SCHEMA_VERSION;
  }
}
