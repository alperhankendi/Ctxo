import { describe, expect, it } from 'vitest';
import type { CodeFact } from '@ctxo/plugin-api';
import { TsMorphAdapter } from '../../ts-morph-adapter.js';
import { DEFAULT_FACT_OPTIONS } from '../fact-options.js';

async function factsOf(file: string, source: string): Promise<CodeFact[]> {
  return new TsMorphAdapter({ facts: DEFAULT_FACT_OPTIONS }).extractFacts(file, source);
}

/** Endpoint texts of `file` with every file of `files` preloaded, as a full index run does. */
async function projectFacts(files: Record<string, string>, file: string): Promise<string[]> {
  const adapter = new TsMorphAdapter({ facts: DEFAULT_FACT_OPTIONS });
  adapter.loadProjectSources(new Map(Object.entries(files)));
  try {
    return (await adapter.extractFacts(file, files[file]!)).map((f) => f.text);
  } finally {
    adapter.clearProjectSources();
  }
}

const texts = async (file: string, source: string) => (await factsOf(file, source)).map((f) => f.text);

describe('Express mount prefixes', () => {
  it('joins a same-file mount and composes nested routers', async () => {
    const source = [
      "import express from 'express';",
      'const app = express();',
      'const api = express.Router();',
      'const v1 = express.Router();',
      "v1.get('/loans/:id', (_req, res) => res.end());",
      "api.post('/holds', (_req, res) => res.end());",
      "api.use('/v1', v1);",
      "app.use('/api', api);",
      "app.get('/health', (_req, res) => res.end());",
    ].join('\n');
    expect(await texts('src/app.ts', source)).toEqual(['GET /api/v1/loans/:id', 'POST /api/holds', 'GET /health']);
  });

  it('a mount without a path, through middleware, or with a constant path', async () => {
    const source = [
      "import express from 'express';",
      'const BASE = "/base";',
      'const app = express();',
      'const a = express.Router();',
      'const b = express.Router();',
      'const c = express.Router();',
      "a.get('/a', h);",
      "b.get('/b', h);",
      "c.get('/c', h);",
      'app.use(a);',
      "app.use('/mw', auth(), b);",
      'app.use(BASE, c);',
      'function h() {}',
      'function auth() { return h; }',
    ].join('\n');
    expect(await texts('src/app.ts', source)).toEqual(['GET /a', 'GET /mw/b', 'GET /base/c']);
  });

  it('a dynamic, conflicting or unresolved mount keeps the route as written', async () => {
    const source = [
      "import express from 'express';",
      'const app = express();',
      'const a = express.Router();',
      'const b = express.Router();',
      'const c = express.Router();',
      "a.get('/a', h);",
      "b.get('/b', h);",
      "c.get('/c', h);",
      'export function mount(base: string) { app.use(base, a); }',
      'app.use(`/v${1}`, c);',
      "app.use('/one', b);",
      "app.use('/two', b);",
      "app.use('/x', require('./other'));",
      'function h() {}',
    ].join('\n');
    expect(await texts('src/app.ts', source)).toEqual(['GET /a', 'GET /b', 'GET /c']);
  });

  it('a mount on a receiver that is not a router module is ignored', async () => {
    const source = [
      "import express from 'express';",
      'const router = express.Router();',
      'declare const other: { use(path: string, r: unknown): void };',
      "router.get('/x', h);",
      "other.use('/api', router);",
      'function h() {}',
    ].join('\n');
    expect(await texts('src/app.ts', source)).toEqual(['GET /x']);
  });

  it('a non-constant middle segment leaves the whole prefix unresolved (never a partial join)', async () => {
    const shapes = [
      'const p = ver(); api.use(p, v1);',
      'api.use(String(process.env.V), v1);',
      "api.use(cond ? '/a' : '/b', v1);",
      "api.use(['/a', '/b'], v1);",
      'api.use(/^\\/v\\d+/, v1);',
      'api.use(`/v${n}`, v1);',
      'api.use(PREFIX, v1);',
      "api.use(cors(), v1);",
    ];
    for (const shape of shapes) {
      const source = [
        "import express from 'express';",
        "import { PREFIX } from './paths';",
        'declare const cond: boolean; declare const n: number;',
        'declare function ver(): string; declare function cors(): () => void;',
        'const app = express();',
        'const api = express.Router();',
        'const v1 = express.Router();',
        "v1.get('/loans', h);",
        shape,
        "app.use('/api', api);",
        'function h() {}',
      ].join('\n');
      expect(await texts('src/app.ts', source), shape).toEqual(['GET /loans']);
    }
  });

  it('a reassigned router is never prefixed by a mount of its earlier value', async () => {
    const source = [
      "import express from 'express';",
      'const app = express();',
      'let r = express.Router();',
      "app.use('/a', r);",
      'r = express.Router();',
      "r.get('/x', h);",
      'function h() {}',
    ].join('\n');
    expect(await texts('src/app.ts', source)).toEqual(['GET /x']);
  });

  it('a mount in another file is not joined, so a full run and a single-file run give the same facts', async () => {
    const files = {
      'src/app.ts': ["import express from 'express';", "import loans from './loans';", "import { holds } from './holds.js';", 'const app = express();', "app.use('/api', loans);", "app.use('/api/holds', holds);"].join('\n'),
      'src/loans.ts': ["import { Router } from 'express';", 'const router = Router();', "router.get('/loans/:id', (_req, res) => res.end());", 'export default router;'].join('\n'),
      'src/holds.ts': [
        "import express from 'express';",
        'export const holds = express.Router();',
        'const inner = express.Router();',
        "inner.delete('/:id', (_req, res) => res.end());",
        "holds.use('/v1', inner);",
      ].join('\n'),
    };
    for (const file of Object.keys(files)) {
      const full = await new TsMorphAdapter({ facts: DEFAULT_FACT_OPTIONS }).extractFacts(file, files[file as keyof typeof files]);
      const adapter = new TsMorphAdapter({ facts: DEFAULT_FACT_OPTIONS });
      adapter.loadProjectSources(new Map(Object.entries(files)));
      const preloaded = await adapter.extractFacts(file, files[file as keyof typeof files]);
      adapter.clearProjectSources();
      expect(preloaded, file).toEqual(full);
    }
    expect(await projectFacts(files, 'src/loans.ts')).toEqual(['GET /loans/:id']);
    // The same-file mount still joins; the cross-file one does not.
    expect(await projectFacts(files, 'src/holds.ts')).toEqual(['DELETE /v1/:id']);
  });
});

describe('Koa routes', () => {
  it('routes on @koa/router and koa-router, the prefix option, named routes, del and nested use', async () => {
    const source = [
      "import Router from '@koa/router';",
      'const api = new Router({ prefix: "/api" });',
      'const loans = new Router();',
      "loans.get('/loans/:id', h);",
      "loans.get('loan', '/named/:id', h);",
      "loans.del('/loans/:id', h);",
      "api.use('/v1', loans.routes(), loans.allowedMethods());",
      "api.post('/holds', h);",
      'function h() {}',
    ].join('\n');
    expect(await texts('src/routes.ts', source)).toEqual(['GET /api/v1/loans/:id', 'GET /api/v1/named/:id', 'DELETE /api/v1/loans/:id', 'POST /api/holds']);

    const legacy = ["const Router = require('koa-router');", 'const router = new Router();', "router.put('/members/:id', h);", 'function h() {}'].join('\n');
    expect(await texts('src/legacy.js', legacy)).toEqual(['PUT /members/:id']);
  });

  it('a dynamic prefix option gives the route as written; without the import nothing', async () => {
    const source = ["import Router from '@koa/router';", 'const router = new Router({ prefix: process.env.P });', "router.get('/x', h);", 'function h() {}'].join('\n');
    expect(await texts('src/a.ts', source)).toEqual(['GET /x']);

    const noImport = ['class Router { get(p: string, h: unknown) {} }', 'const router = new Router();', "router.get('/x', h);", 'function h() {}'].join('\n');
    expect(await texts('src/b.ts', noImport)).toEqual([]);
  });
});

describe('Hono routes', () => {
  it('routes, basePath and route() mounts compose', async () => {
    const source = [
      "import { Hono } from 'hono';",
      'const app = new Hono();',
      "const api = new Hono().basePath('/api');",
      'const books = new Hono();',
      "books.get('/:id', (c) => c.text('x'));",
      "books.post('/', (c) => c.text('x'));",
      "api.route('/books', books);",
      "app.route('/', api);",
      "app.get('/health', (c) => c.text('ok'));",
    ].join('\n');
    expect(await texts('src/app.ts', source)).toEqual(['GET /api/books/:id', 'POST /api/books', 'GET /health']);
  });

  it('a dynamic basePath or route() path keeps the route as written', async () => {
    const source = [
      "import { Hono } from 'hono';",
      'declare const base: string;',
      'const app = new Hono();',
      'const a = new Hono().basePath(base);',
      'const b = new Hono();',
      "a.get('/a', (c) => c.text('x'));",
      "b.get('/b', (c) => c.text('x'));",
      'app.route(base, b);',
    ].join('\n');
    expect(await texts('src/app.ts', source)).toEqual(['GET /a', 'GET /b']);
  });

  it('a get on something that is not Hono gives nothing', async () => {
    const source = ["import { Hono } from 'hono';", 'const m = new Map<string, string>();', "m.get('/x');", "const app = new Hono();", "app.get('/y', (c) => c.text('y'));"].join('\n');
    expect(await texts('src/app.ts', source)).toEqual(['GET /y']);
  });
});
