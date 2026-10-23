import { CONFIG } from './config.ts';
import { cleanText, extractCandidateSentences, scoreAndSelectBullets, type BulletItem } from './answer.ts';
import { analyzeQuery, evaluateCoverage, type CoverageDecision } from './queryAnalysis.ts';
import { VectorStore } from './search.ts';
import type { ScoredChunk, SearchResult } from './types.ts';

export type EngineSource = { fileName: string; page: number; score?: number };
export type EngineResult = {
  answer: string;
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
    if (type === 'ready') return;
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
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    startWorker().postMessage({ type: 'embed', id, text });
  });
}

function embedBatch(texts: string[]): Promise<Float32Array> {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    startWorker().postMessage({ type: 'embed_batch', id, texts });
  });
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

function makeAnswer(coverage: CoverageDecision, bullets: BulletItem[], passages: ScoredChunk[]): string {
  if (coverage.type === 'NONE') return CONFIG.OUT_OF_CONTEXT_MESSAGE;
  const prefix = [coverage.limitationMessage, coverage.scopeNote].filter(Boolean).join(' ');
  const points = bullets.slice(0, 3).map(item => `• ${cleanText(item.text)} [${item.sourceFile} · p. ${item.page}]`);
  if (!points.length) {
    const fallback = passages.slice(0, 2).map(p => `• ${cleanText(p.text).slice(0, 240)} [${p.sourceFile} · p. ${p.pageStart}]`);
    return [prefix, ...fallback].filter(Boolean).join('\n');
  }
  return [prefix, ...points].filter(Boolean).join('\n');
}

export async function askEngine(query: string): Promise<EngineResult> {
  const question = query.trim().slice(0, 300);
  if (!question) throw new Error('Enter a question.');
  await loadEngine();
  if (!store) throw new Error('Search engine is unavailable.');
  const queryVector = await embed(question);
  const search: SearchResult = store.search(question, queryVector, CONFIG.TOP_K);
  const analysis = analyzeQuery(question);
  const topText = search.results.map(item => item.text).join(' ');
  const termPages = store.getTermPages();
  const hasKnownUnqualifiedTerm = analysis.topic === null && (analysis.aspects.includes('hostel') || analysis.aspects.every(aspect => {
    const terms = aspect.split(/[_\s-]+/).filter(Boolean);
    return terms.some(term => Boolean(termPages[term.toLowerCase()]?.length));
  }));
  const coverage = !hasKnownUnqualifiedTerm && analysis.topic === null
    ? evaluateCoverage({ ...analysis, aspects: [] }, topText, termPages, Math.min(search.topScore, 0.19))
    : evaluateCoverage(analysis, topText, termPages, search.topScore);
  let bullets: BulletItem[] = [];
  if (coverage.type !== 'NONE') {
    const candidates = extractCandidateSentences(search.results);
    if (candidates.length) {
      const candidateVectors = await embedBatch(candidates.map(item => item.text));
      bullets = scoreAndSelectBullets(question, queryVector, candidates, candidateVectors, 384);
    }
  }
  return {
    answer: makeAnswer(coverage, bullets, search.results),
    sources: search.results.slice(0, 3).map(item => ({ fileName: item.sourceFile, page: item.pageStart, score: item.score })),
    coverage,
    score: search.topScore,
    passages: search.results,
    ready: true,
  };
}
