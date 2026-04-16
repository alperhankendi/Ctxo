import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SqliteStorageAdapter } from '../../../packages/cli/src/adapters/storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../packages/cli/src/core/masking/masking-pipeline.js';
import { SimpleGitAdapter } from '../../../packages/cli/src/adapters/git/simple-git-adapter.js';
import { handleGetLogicSlice } from '../../../packages/cli/src/adapters/mcp/get-logic-slice.js';
import { handleGetWhyContext } from '../../../packages/cli/src/adapters/mcp/get-why-context.js';
import { handleGetChangeIntelligence } from '../../../packages/cli/src/adapters/mcp/get-change-intelligence.js';
import { handleGetBlastRadius } from '../../../packages/cli/src/adapters/mcp/get-blast-radius.js';
import { handleGetArchitecturalOverlay } from '../../../packages/cli/src/adapters/mcp/get-architectural-overlay.js';
import { handleFindDeadCode } from '../../../packages/cli/src/adapters/mcp/get-dead-code.js';
import { handleGetContextForTask } from '../../../packages/cli/src/adapters/mcp/get-context-for-task.js';
import { handleGetRankedContext } from '../../../packages/cli/src/adapters/mcp/get-ranked-context.js';
import { handleSearchSymbols } from '../../../packages/cli/src/adapters/mcp/search-symbols.js';
import { handleGetChangedSymbols } from '../../../packages/cli/src/adapters/mcp/get-changed-symbols.js';
import { handleFindImporters } from '../../../packages/cli/src/adapters/mcp/find-importers.js';
import { handleGetClassHierarchy } from '../../../packages/cli/src/adapters/mcp/get-class-hierarchy.js';
import { handleGetSymbolImportance } from '../../../packages/cli/src/adapters/mcp/get-symbol-importance.js';
import { handleGetPrImpact } from '../../../packages/cli/src/adapters/mcp/get-pr-impact.js';
import { StalenessDetector } from '../../../packages/cli/src/core/staleness/staleness-detector.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  const ctxoRoot = '.ctxo';
  const storage = new SqliteStorageAdapter(ctxoRoot, { allowProductionPath: true });
  await storage.init();
  const masking = new MaskingPipeline();
  const git = new SimpleGitAdapter(process.cwd());
  const staleness = new StalenessDetector(process.cwd(), ctxoRoot);

  const server = new McpServer({ name: 'ctxo', version: '0.1.0' });

  // Register all 13 tools
  server.registerTool('get_logic_slice', {
    description: 'LS', inputSchema: { symbolId: z.string().optional(), symbolIds: z.array(z.string()).optional(), level: z.number().min(1).max(4).optional().default(3) }
  }, (args: any) => handleGetLogicSlice(storage, masking, staleness, ctxoRoot)(args));

  server.registerTool('get_blast_radius', {
    description: 'BR', inputSchema: { symbolId: z.string() }
  }, (args: any) => handleGetBlastRadius(storage, masking, staleness, ctxoRoot)(args));

  server.registerTool('get_architectural_overlay', {
    description: 'AO', inputSchema: {}
  }, (args: any) => handleGetArchitecturalOverlay(storage, masking, staleness, ctxoRoot)(args));

  server.registerTool('get_why_context', {
    description: 'WC', inputSchema: { symbolId: z.string(), maxCommits: z.number().int().min(1).optional() }
  }, (args: any) => handleGetWhyContext(storage, git, masking, staleness, ctxoRoot)(args));

  server.registerTool('get_change_intelligence', {
    description: 'CI', inputSchema: { symbolId: z.string() }
  }, (args: any) => handleGetChangeIntelligence(storage, git, masking, staleness, ctxoRoot)(args));

  server.registerTool('find_dead_code', {
    description: 'DC', inputSchema: { includeTests: z.boolean().optional() }
  }, (args: any) => handleFindDeadCode(storage, masking, staleness, ctxoRoot)(args));

  server.registerTool('get_context_for_task', {
    description: 'CT', inputSchema: { symbolId: z.string(), taskType: z.string(), tokenBudget: z.number().optional() }
  }, (args: any) => handleGetContextForTask(storage, masking, staleness, ctxoRoot)(args));

  server.registerTool('get_ranked_context', {
    description: 'RC', inputSchema: { query: z.string(), tokenBudget: z.number().optional(), strategy: z.string().optional() }
  }, (args: any) => handleGetRankedContext(storage, masking, staleness, ctxoRoot)(args));

  server.registerTool('search_symbols', {
    description: 'SS', inputSchema: { pattern: z.string(), kind: z.string().optional(), filePattern: z.string().optional(), limit: z.number().optional() }
  }, (args: any) => handleSearchSymbols(storage, masking, staleness, ctxoRoot)(args));

  server.registerTool('get_changed_symbols', {
    description: 'CS', inputSchema: { since: z.string().optional(), maxFiles: z.number().optional() }
  }, (args: any) => handleGetChangedSymbols(storage, git, masking, staleness, ctxoRoot)(args));

  server.registerTool('find_importers', {
    description: 'FI', inputSchema: { symbolId: z.string(), transitive: z.boolean().optional(), edgeKinds: z.array(z.string()).optional(), maxDepth: z.number().optional() }
  }, (args: any) => handleFindImporters(storage, masking, staleness, ctxoRoot)(args));

  server.registerTool('get_class_hierarchy', {
    description: 'CH', inputSchema: { symbolId: z.string().optional(), direction: z.string().optional() }
  }, (args: any) => handleGetClassHierarchy(storage, masking, staleness, ctxoRoot)(args));

  server.registerTool('get_symbol_importance', {
    description: 'SI', inputSchema: { limit: z.number().optional(), kind: z.string().optional(), filePattern: z.string().optional(), damping: z.number().optional() }
  }, (args: any) => handleGetSymbolImportance(storage, masking, staleness, ctxoRoot)(args));

  server.registerTool('get_pr_impact', {
    description: 'PI', inputSchema: { since: z.string().optional(), maxFiles: z.number().optional(), confidence: z.string().optional() }
  }, (args: any) => handleGetPrImpact(storage, git, masking, staleness, ctxoRoot)(args));

  // Connect with InMemoryTransport
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  // Run all 14 tool tests
  const tests: [string, Record<string, any>][] = [
    ['get_logic_slice', { symbolId: 'packages/cli/src/core/logic-slice/logic-slice-query.ts::LogicSliceQuery::class', level: 3 }],
    ['get_blast_radius', { symbolId: 'packages/cli/src/core/types.ts::SymbolNode::type' }],
    ['get_architectural_overlay', {}],
    ['get_why_context', { symbolId: 'packages/cli/src/core/masking/masking-pipeline.ts::MaskingPipeline::class' }],
    ['get_change_intelligence', { symbolId: 'packages/cli/src/adapters/storage/sqlite-storage-adapter.ts::SqliteStorageAdapter::class' }],
    ['find_dead_code', {}],
    ['get_context_for_task', { symbolId: 'packages/cli/src/core/graph/symbol-graph.ts::SymbolGraph::class', taskType: 'understand' }],
    ['get_ranked_context', { query: 'masking', tokenBudget: 2000 }],
    ['search_symbols', { pattern: '^handle', kind: 'function' }],
    ['get_changed_symbols', { since: 'HEAD~3' }],
    ['find_importers', { symbolId: 'packages/cli/src/core/types.ts::SymbolNode::type', transitive: true }],
    ['get_class_hierarchy', {}],
    ['get_symbol_importance', { limit: 10 }],
    ['get_pr_impact', { since: 'HEAD~3' }],
  ];

  let pass = 0, fail = 0;
  for (const [name, args] of tests) {
    try {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as any)[0]?.text;
      const d = JSON.parse(text);
      if (d.error) { console.log(`${name}: APP_ERR ${d.message}`); fail++; continue; }
      if (d.found === false) { console.log(`${name}: NOT_FOUND ${d.hint||''}`); fail++; continue; }

      let s = '';
      switch(name) {
        case 'get_logic_slice': s=`root=${d.root?.name} deps=${d.dependencies?.length} edges=${d.edges?.length}`; break;
        case 'get_blast_radius': s=`impact=${d.impactScore} conf=${d.confirmedCount} pot=${d.potentialCount} risk=${d.overallRiskScore?.toFixed(3)}`; break;
        case 'get_architectural_overlay': { const l=d.layers||{}; s=Object.entries(l).map(([k,v])=>`${k}=${(v as any[]).length}`).join(' '); break; }
        case 'get_why_context': s=`commits=${d.commitHistory?.length} anti=${d.antiPatternWarnings?.length}`; break;
        case 'get_change_intelligence': s=`cx=${d.complexity} churn=${d.churn} comp=${d.composite} band=${d.band}`; break;
        case 'find_dead_code': s=`total=${d.totalSymbols} reach=${d.reachableSymbols} dead=${d.deadSymbols?.length} files=${d.deadFiles?.length} pct=${d.deadCodePercentage}% unused=${d.unusedExports?.length} scaff=${d.scaffolding?.length}`; break;
        case 'get_context_for_task': s=`ctx=${d.context?.length} tok=${d.totalTokens}`; break;
        case 'get_ranked_context': s=`res=${d.results?.length} tok=${d.totalTokens} top=${d.results?.[0]?.name}`; break;
        case 'search_symbols': s=`match=${d.totalMatches} top=${d.results?.[0]?.name}`; break;
        case 'get_changed_symbols': s=`files=${d.changedFiles} syms=${d.changedSymbols}`; break;
        case 'find_importers': s=`imp=${d.importerCount} maxD=${Math.max(0,...(d.importers||[]).map((x:any)=>x.depth))}`; break;
        case 'get_class_hierarchy': s=`hier=${d.hierarchies?.length} cls=${d.totalClasses} edges=${d.totalEdges}`; break;
        case 'get_symbol_importance': s=`syms=${d.totalSymbols} conv=${d.converged} iter=${d.iterations} top=${d.rankings?.[0]?.name}`; break;
        case 'get_pr_impact': s=`files=${d.changedFiles} syms=${d.changedSymbols} risk=${d.riskLevel}`; break;
      }
      console.log(`${name}: PASS | ${s}`);
      pass++;
    } catch(e: any) {
      console.log(`${name}: ERR ${e.message}`);
      fail++;
    }
  }

  console.log(`\n=== RESULT: ${pass}/14 passed, ${fail} failed ===`);
  await client.close();
  await server.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
