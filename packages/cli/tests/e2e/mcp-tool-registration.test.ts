import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InputSchema as findImporters } from '../../src/adapters/mcp/find-importers.js';
import { InputSchema as overlay } from '../../src/adapters/mcp/get-architectural-overlay.js';
import { InputSchema as blastRadius } from '../../src/adapters/mcp/get-blast-radius.js';
import { InputSchema as changeIntelligence } from '../../src/adapters/mcp/get-change-intelligence.js';
import { InputSchema as changedSymbols } from '../../src/adapters/mcp/get-changed-symbols.js';
import { InputSchema as classHierarchy } from '../../src/adapters/mcp/get-class-hierarchy.js';
import { InputSchema as contextForTask } from '../../src/adapters/mcp/get-context-for-task.js';
import { InputSchema as deadCode } from '../../src/adapters/mcp/get-dead-code.js';
import { InputSchema as logicSlice } from '../../src/adapters/mcp/get-logic-slice.js';
import { InputSchema as prImpact } from '../../src/adapters/mcp/get-pr-impact.js';
import { InputSchema as rankedContext } from '../../src/adapters/mcp/get-ranked-context.js';
import { InputSchema as symbolImportance } from '../../src/adapters/mcp/get-symbol-importance.js';
import { InputSchema as whyContext } from '../../src/adapters/mcp/get-why-context.js';
import { InputSchema as searchSymbols } from '../../src/adapters/mcp/search-symbols.js';

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const HANDLER_SCHEMAS: Record<string, z.ZodType> = {
  find_importers: findImporters,
  get_architectural_overlay: overlay,
  get_blast_radius: blastRadius,
  get_change_intelligence: changeIntelligence,
  get_changed_symbols: changedSymbols,
  get_class_hierarchy: classHierarchy,
  get_context_for_task: contextForTask,
  find_dead_code: deadCode,
  get_logic_slice: logicSlice,
  get_pr_impact: prImpact,
  get_ranked_context: rankedContext,
  get_symbol_importance: symbolImportance,
  get_why_context: whyContext,
  search_symbols: searchSymbols,
};

interface JsonProp {
  enum?: unknown[];
  items?: { enum?: unknown[] };
}
interface JsonSchema {
  properties?: Record<string, JsonProp>;
  required?: string[];
}

const sorted = (values: readonly unknown[] | undefined) => [...(values ?? [])].map(String).sort();

describe('MCP tool registration vs handler schemas', () => {
  let client: Client;
  let cwd: string;
  let tools: Array<{ name: string; description?: string; inputSchema: JsonSchema }>;

  beforeAll(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'ctxo-registration-'));
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    delete env['CTXO_HTTP_PORT'];
    client = new Client({ name: 'registration-test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(CLI_ROOT, 'dist', 'index.js')],
        cwd,
        env,
        stderr: 'ignore',
      }),
    );
    tools = (await client.listTools()).tools as unknown as typeof tools;
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('the server registers exactly the 14 handler tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(HANDLER_SCHEMAS).sort());
  });

  it("every tool's properties, required list and enum values match its handler schema", () => {
    for (const tool of tools) {
      const handlerJson = z.toJSONSchema(HANDLER_SCHEMAS[tool.name]!, { io: 'input' }) as JsonSchema;
      const registered = tool.inputSchema;
      expect(sorted(Object.keys(registered.properties ?? {})), `${tool.name} properties`).toEqual(
        sorted(Object.keys(handlerJson.properties ?? {})),
      );
      expect(sorted(registered.required), `${tool.name} required`).toEqual(sorted(handlerJson.required));
      for (const [name, prop] of Object.entries(handlerJson.properties ?? {})) {
        const reg = registered.properties?.[name];
        if (prop.enum) expect(sorted(reg?.enum), `${tool.name}.${name} enum`).toEqual(sorted(prop.enum));
        if (prop.items?.enum) {
          expect(sorted(reg?.items?.enum), `${tool.name}.${name} items.enum`).toEqual(sorted(prop.items.enum));
        }
      }
    }
  });

  it('overlay mode includes contexts and takes candidate, ranked context has searchMode and no fuzzy, search_symbols has mode', () => {
    const byName = new Map(tools.map((t) => [t.name, t.inputSchema]));
    expect(sorted(byName.get('get_architectural_overlay')?.properties?.['mode']?.enum)).toEqual([
      'both',
      'communities',
      'contexts',
      'regex',
    ]);
    expect(byName.get('get_architectural_overlay')?.properties?.['candidate']).toBeDefined();
    const ranked = byName.get('get_ranked_context')?.properties ?? {};
    expect(ranked['searchMode']).toBeDefined();
    expect(ranked['fuzzy']).toBeUndefined();
    expect(sorted(byName.get('search_symbols')?.properties?.['mode']?.enum)).toEqual(['fts', 'regex']);
  });

  it('descriptions match the tiers, the dead-code rule for .sql files and the overlay data lists', () => {
    const description = (name: string) => tools.find((t) => t.name === name)?.description ?? '';

    const blast = description('get_blast_radius');
    expect(blast).not.toContain('BEFORE modifying any function or class');
    expect(blast).not.toContain('potential (transitive)');
    expect(blast).toContain('table, view or procedure');
    expect(blast).toContain('directly or transitively');
    expect(blast).toContain('the data edges `reads`, `writes`, `executes`');
    expect(blast).toContain('likely (co-changed or `uses`)');
    expect(blast).toContain('potential (`imports`)');
    expect(blast).toContain('`coChangedFiles` lists up to 10 files');

    expect(description('find_dead_code')).toContain('Symbols in .sql files are never reported.');

    const overlay = description('get_architectural_overlay');
    expect(overlay).not.toContain('with writers');
    expect(overlay).toContain('writer count');
    expect(overlay).toContain('Both lists hold fewer entries when the response limit requires');
    expect(overlay).toContain('sharedTableCount and dataResourcesTotal');
  });
});
