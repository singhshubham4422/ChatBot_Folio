import { CONFIG, detectAnswerMode, type AnswerMode } from './config.ts';
import { cleanText, extractCandidateSentences, isUsefulAnswerText, scoreAndSelectBullets, type BulletItem } from './answer.ts';
import { analyzeQuery, evaluateCoverage, type CoverageDecision } from './queryAnalysis.ts';
import { VectorStore } from './search.ts';
import type { ScoredChunk, SearchResult, TableData } from './types.ts';
import { tableNumbersAreGrounded } from './tables.ts';

export type EngineSource = { fileName: string; page: number; pageEnd: number; sectionTitle: string };
export type AnswerBlock = {
  sourceFile: string;
  sectionTitle: string;
  pageStart: number;
  pageEnd: number;
  type: 'text' | 'table' | 'list';
  tables: TableData[];
  bullets: string[];
  qualifiers: string[];
  originalText: string;
};
export type EngineResult = {
  answer: string;
  mode: AnswerMode;
  blocks: AnswerBlock[];
  sources: EngineSource[];
  coverage: CoverageDecision;
  score: number;
  passages: ScoredChunk[];
  ready: boolean;
};

let store: VectorStore | null = null;
let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: (value: Float32Array) => void; reject: (error: Error) => void }>();

function startWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = event => {
    const { type, id, vector, error } = event.data ?? {};
    if (type === 'embed_result' || type === 'embed_batch_result') {
      const item = pending.get(id);
      if (item && vector) { pending.delete(id); item.resolve(vector); }
    }
    if (type === 'embed_error' || type === 'embed_batch_error' || type === 'error') {
      const item = pending.get(id);
      if (item) { pending.delete(id); item.reject(new Error(error || 'Embedding failed.')); }
    }
  };
  return worker;
}

function embed(text: string): Promise<Float32Array> {
  const id = ++requestId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); startWorker().postMessage({ type: 'embed', id, text }); });
}

function embedBatch(texts: string[]): Promise<Float32Array> {
  const id = ++requestId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); startWorker().postMessage({ type: 'embed_batch', id, texts }); });
}

export function loadEngine(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    store = new VectorStore();
    await store.load(`${import.meta.env.BASE_URL}index.json`);
    const currentWorker = startWorker();
    await new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type === 'ready') { currentWorker.removeEventListener('message', onMessage); resolve(); }
        if (event.data?.type === 'error') { currentWorker.removeEventListener('message', onMessage); reject(new Error(event.data.error || 'Embedding model failed.')); }
      };
      currentWorker.addEventListener('message', onMessage);
      currentWorker.postMessage({ type: 'init' });
    });
  })().catch(error => { readyPromise = null; throw error; });
  return readyPromise;
}

export function validateTableNumbers(table: TableData, sourceText: string): boolean {
  return tableNumbersAreGrounded(table, sourceText);
}

function makeBlock(hit: ScoredChunk, section: ScoredChunk[], bullets: BulletItem[], mode: AnswerMode): AnswerBlock {
  const originalText = section.map(chunk => cleanText(chunk.text.replace(/^Section:\s*[^\n]+\n?/i, ''))).join('\n');
  const tables = [...new Map(section.flatMap(chunk => chunk.tables ?? []).map(table => [`${table.page}:${table.heading}`, table])).values()]
    .filter(table => validateTableNumbers(table, originalText));
  const usefulBullets = bullets.map(item => cleanText(item.text)).filter(isUsefulAnswerText).slice(0, mode === 'DETAILED' ? 4 : 2);
  const pages = section.flatMap(chunk => [chunk.pageStart, chunk.pageEnd]);
  return {
    sourceFile: hit.sourceFile,
    sectionTitle: hit.sectionTitle,
    pageStart: Math.min(...pages),
    pageEnd: Math.max(...pages),
    type: tables.length ? 'table' : (hit.type === 'list' ? 'list' : 'text'),
    tables,
    bullets: usefulBullets,
    qualifiers: [...new Set(section.flatMap(chunk => chunk.qualifiers ?? []))],
    originalText,
  };
}

function summaryFor(block: AnswerBlock, coverage: CoverageDecision): string {
  if (coverage.type === 'NONE') return CONFIG.OUT_OF_CONTEXT_MESSAGE;
  const scope = [coverage.limitationMessage, coverage.scopeNote].filter(Boolean).join(' ');
  const detail = block.tables[0]?.rows[0]?.filter(Boolean).join(': ') || block.bullets[0] || block.originalText.split(/[.!?]\s+/)[0];
  return [scope, cleanText(detail)].filter(Boolean).join(' ');
}

export async function askEngine(query: string): Promise<EngineResult> {
  const question = query.trim().slice(0, 300);
  if (!question) throw new Error('Enter a question.');
  await loadEngine();
  if (!store) throw new Error('Search engine is unavailable.');
  const queryVector = await embed(question);
  const search: SearchResult = store.search(question, queryVector, CONFIG.TOP_K);
  const analysis = analyzeQuery(question);
  const termPages = store.getTermPages();
  const topText = search.results.map(item => item.text).join(' ');
  const hasKnownUnqualifiedTerm = analysis.topic === null && (analysis.aspects.includes('hostel') || analysis.aspects.every(aspect => aspect.split(/[_\s-]+/).some(term => Boolean(termPages[term.toLowerCase()]?.length))));
  const coverage = !hasKnownUnqualifiedTerm && analysis.topic === null
    ? evaluateCoverage({ ...analysis, aspects: [] }, topText, termPages, Math.min(search.topScore, 0.19))
    : evaluateCoverage(analysis, topText, termPages, search.topScore);
  const mode = detectAnswerMode(question);
  if (coverage.type === 'NONE' || !search.results.length) return { answer: CONFIG.OUT_OF_CONTEXT_MESSAGE, mode, blocks: [], sources: [], coverage, score: search.topScore, passages: search.results, ready: true };

  const hit = search.results.find(result => result.routingBoost > 0) ?? search.results[0];
  const sectionChunks = store.expandSection(hit.sectionTitle, hit.sourceFile, 900);
  const expanded = sectionChunks.length ? sectionChunks : [hit];
  const expandedScored: ScoredChunk[] = expanded.map(chunk => ({ ...chunk, embeddingScore: hit.embeddingScore, bm25Score: hit.bm25Score, routingBoost: hit.routingBoost, score: hit.score }));
  const candidates = extractCandidateSentences(expandedScored);
  const candidateVectors = candidates.length ? await embedBatch(candidates.map(item => item.text)) : new Float32Array();
  const bullets = candidates.length ? scoreAndSelectBullets(question, queryVector, candidates, candidateVectors, 384) : [];
  const block = makeBlock(hit, expandedScored, bullets, mode);
  const answer = summaryFor(block, coverage);
  const source: EngineSource = { fileName: block.sourceFile, page: block.pageStart, pageEnd: block.pageEnd, sectionTitle: block.sectionTitle };
  return { answer, mode, blocks: [block], sources: [source], coverage, score: search.topScore, passages: expandedScored, ready: true };
}
