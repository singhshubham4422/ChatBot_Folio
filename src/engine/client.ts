import { CONFIG, detectAnswerMode, type AnswerMode } from './config.ts';
import { cleanText, extractCandidateSentences, isUsefulAnswerText, scoreAndSelectBullets, type BulletItem } from './answer.ts';
import { analyzeQuery, evaluateCoverage, type CoverageDecision } from './queryAnalysis.ts';
import { VectorStore } from './search.ts';
import type { ScoredChunk, SearchResult, TableData } from './types.ts';
import { tableNumbersAreGrounded } from './tables.ts';
import { classifyIntent, parseCitations, rewriteFollowup, sanitizeMarkdown, smallTalkReply, STARTER_CHIPS, stripNext, numbersAreGrounded, type ConversationTurn, type Intent } from './conversation';

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
  intent?: Intent;
  rewrittenQuery?: string;
  generatedAnswer?: string;
  generatedCitations?: EngineSource[];
  nextQuestion?: string;
  fallback?: boolean;
  provider?: string;
};

function emptyCoverage(): CoverageDecision { return { type: 'NONE', topic: null, missingAspect: null, presentAspect: null, limitationMessage: null, scopeNote: null, suggestedQuestions: STARTER_CHIPS, disambiguationChips: [] }; }

function smallTalkResult(intent: Intent): EngineResult {
  return { answer: smallTalkReply(intent as Exclude<Intent, 'DOC_QUESTION' | 'FOLLOWUP' | 'CHITCHAT' | 'UNSAFE'>), mode: 'SHORT', blocks: [], sources: [], coverage: emptyCoverage(), score: 0, passages: [], ready: true, intent };
}

async function generatedAnswer(question: string, history: ConversationTurn[], result: EngineResult, signal?: AbortSignal, onToken?: (text: string) => void): Promise<Pick<EngineResult, 'generatedAnswer' | 'generatedCitations' | 'nextQuestion' | 'fallback' | 'provider'>> {
  if (result.coverage.type === 'NONE' || !result.passages.length) return { fallback: true, provider: 'extractive' };
  const evidence = result.passages.slice(0, 6).map((passage, index) => ({ id: index + 1, file: passage.sourceFile, page: passage.pageStart, section: passage.sectionTitle, text: passage.text.slice(0, 1800), table: passage.tables?.map(table => `${table.heading}\n${table.columns.join(' | ')}\n${table.rows.map(row => row.join(' | ')).join('\n')}`).join('\n') }));
  let response: Response;
  try {
    response = await fetch('/api/conversation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ question, history: history.slice(-4).map(turn => `${turn.role}: ${turn.text}`), passages: evidence }) });
  } catch { return { fallback: true, provider: 'extractive' }; }
  if (!response.ok || !response.body) return { fallback: true, provider: 'extractive' };
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let answer = ''; let failed = false; let provider = 'online';
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (const record of buffer.split('\n\n').slice(0, -1)) {
      const event = record.match(/^event: (.+)\ndata: (.+)$/s); if (!event) continue;
      try { const data = JSON.parse(event[2]); if (event[1] === 'token') { answer += typeof data === 'string' ? data : ''; onToken?.(answer); } if (event[1] === 'done') provider = data.provider ?? provider; if (event[1] === 'error') failed = true; } catch { failed = true; }
    }
    buffer = buffer.split('\n\n').at(-1) ?? '';
  }
  if (failed || !answer.trim()) return { fallback: true, provider: 'extractive' };
  const withNext = stripNext(answer); const parsed = parseCitations(withNext.text, new Set(evidence.map((_item, index) => index + 1)));
  const citationSources = parsed.citations.map(id => { const item = evidence[id - 1]; return { fileName: item.file, page: item.page, pageEnd: item.page, sectionTitle: item.section }; });
  if (!parsed.citations.length || !numbersAreGrounded(parsed.text, evidence.map(item => item.text).join(' '))) return { fallback: true, provider: 'extractive' };
  return { generatedAnswer: parsed.text, generatedCitations: citationSources, nextQuestion: withNext.next, fallback: false, provider };
}

export async function askConversational(input: string, history: ConversationTurn[] = [], signal?: AbortSignal, onToken?: (text: string) => void): Promise<EngineResult> {
  const intent = classifyIntent(input);
  if (intent === 'GREETING' || intent === 'THANKS' || intent === 'GOODBYE' || intent === 'ABOUT_BOT') return { ...smallTalkResult(intent), nextQuestion: STARTER_CHIPS[0] };
  if (intent === 'UNSAFE') return { ...smallTalkResult('ABOUT_BOT'), answer: 'I can’t follow instructions that try to override my safeguards. I can help with the official BITS admissions documents.', intent };
  if (intent === 'CHITCHAT') return { ...smallTalkResult('ABOUT_BOT'), answer: 'That’s outside what I can help with. I can answer questions about BITS admissions, for example: BITSAT 2026 dates, First Degree eligibility, or Higher Degree fees.', intent };
  const rewrittenQuery = intent === 'FOLLOWUP' ? rewriteFollowup(input, history) : input.trim().slice(0, 300);
  const result = await askEngine(rewrittenQuery);
  if (result.coverage.disambiguationChips.length > 0) {
    return { ...result, intent, rewrittenQuery, blocks: [], sources: [], passages: [], answer: 'Which programme or admission scheme do you mean?', provider: 'none', fallback: false };
  }
  const generated = await generatedAnswer(rewrittenQuery, history, result, signal, onToken);
  return { ...result, intent, rewrittenQuery, ...generated, answer: generated.fallback ? `${result.answer} Showing document excerpts.` : (generated.generatedAnswer ?? result.answer) };
}

export { sanitizeMarkdown };

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
