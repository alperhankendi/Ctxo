import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', 'docs', '.vitepress', 'dist');
const to = join(here, '..', '..', 'pages', 'docs');

if (!existsSync(from)) {
  console.error(`[copy-to-pages] build output not found at ${from}`);
  process.exit(1);
}

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
console.log(`[copy-to-pages] ${from} -> ${to}`);
