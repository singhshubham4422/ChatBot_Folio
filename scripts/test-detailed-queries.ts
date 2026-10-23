import { readFile } from 'node:fs/promises';
import { pipeline } from '@huggingface/transformers';
import { CONFIG, detectAnswerMode } from '../src/engine/config.ts';
import { analyzeQuery, evaluateCoverage } from '../src/engine/queryAnalysis.ts';
import { VectorStore } from '../src/engine/search.ts';
import { tableNumbersAreGrounded } from '../src/engine/tables.ts';

const queries = [
  'First Degree semester fees', 'fees', 'Higher Degree M.E. fees', 'ISA international student fees',
  'BITSAT application dates', 'eligibility for BITSAT', 'documents required', 'test centers in Delhi',
  'what is the marking scheme for BITSAT-2026',
];

const raw = await readFile('public/index.json', 'utf8');
const store = new VectorStore();
await store.load(`data:application/json,${encodeURIComponent(raw)}`);
const embedder = await pipeline('feature-extraction', CONFIG.MODEL_NAME, { dtype: 'q8' });

for (const query of queries) {
  const output = await embedder(query, { pooling: 'mean', normalize: true });
  const search = store.search(query, Float32Array.from(output.data as Float32Array), CONFIG.TOP_K);
  const analysis = analyzeQuery(query);
  const coverage = evaluateCoverage(analysis, search.results.map(result => result.text).join(' '), store.getTermPages(), search.topScore);
  const hit = search.results.find(result => result.routingBoost > 0) ?? search.results[0];
  const section = hit ? store.expandSection(hit.sectionTitle, hit.sourceFile, 900) : [];
  const sourceText = section.map(chunk => chunk.text).join(' ');
  const tables = [...new Map(section.flatMap(chunk => chunk.tables ?? []).map(table => [`${table.page}:${table.heading}`, table])).values()];
  const grounded = tables.every(table => tableNumbersAreGrounded(table, sourceText));
  const pages = section.length ? `${Math.min(...section.map(chunk => chunk.pageStart))}-${Math.max(...section.map(chunk => chunk.pageEnd))}` : 'none';
  console.log(JSON.stringify({ query, mode: detectAnswerMode(query), coverage: coverage.type, sectionTitle: hit?.sectionTitle ?? 'none', pages, tableRendered: tables.length > 0, rows: tables.reduce((count, table) => count + table.rows.length, 0), everyNumberInSource: grounded, source: hit ? `${hit.sourceFile} · p. ${pages}` : 'none' }));
}
