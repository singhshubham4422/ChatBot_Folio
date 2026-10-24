import { CONFIG, detectAnswerMode, type AnswerMode } from './config.ts';
import { cleanText, extractCandidateSentences, isUsefulAnswerText, scoreAndSelectBullets, type BulletItem } from './answer.ts';
import { analyzeQuery, evaluateCoverage, isUnsupportedDocumentQuestion, type CoverageDecision } from './queryAnalysis.ts';
import { VectorStore } from './search.ts';
import type { ScoredChunk, SearchResult, TableData } from './types.ts';
import { tableNumbersAreGrounded } from './tables.ts';
import { classifyIntent, hasLongVerbatimCopy, parseCitations, rewriteFollowup, sanitizeMarkdown, smallTalkReply, STARTER_CHIPS, stripNext, numbersAreGrounded, type ConversationTurn, type Intent } from './conversation';
import { loadFaqKnowledge, matchConversationIntent, matchFaq, type FaqRecord, type FaqSourceReference } from './faq';

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
  fallbackReason?: string;
  provider?: string;
  faqId?: string;
  faqSources?: FaqSourceReference[];
  faqSuggestions?: string[];
  faqMatchedBy?: 'exact' | 'alias' | 'keywords';
};

function emptyCoverage(): CoverageDecision { return { type: 'NONE', topic: null, missingAspect: null, presentAspect: null, limitationMessage: null, scopeNote: null, suggestedQuestions: STARTER_CHIPS, disambiguationChips: [] }; }

function smallTalkResult(intent: Intent): EngineResult {
  return { answer: smallTalkReply(intent as Exclude<Intent, 'DOC_QUESTION' | 'FOLLOWUP' | 'CHITCHAT' | 'UNSAFE'>), mode: 'SHORT', blocks: [], sources: [], coverage: emptyCoverage(), score: 0, passages: [], ready: true, intent };
}

function faqResult(record: FaqRecord, matchedBy: 'exact' | 'alias' | 'keywords'): EngineResult {
  const rawReferences = record.source_references ?? record.source_files.map((file, index) => ({ file, pages: record.source_pages[index] ?? record.source_pages[0] ?? '?', admission_year: record.admission_year }));
  const faqSources = rawReferences.map(reference => {
    const label = reference.file.includes('BITSAT') ? 'BITSAT-2026' : reference.file.includes('Admission_Modality') ? 'FD-Admission-Modality' : reference.file.includes('HD_Brochure') ? 'BITS-HD-2025-26' : '';
    const pages = label && reference.pages.includes(';')
      ? reference.pages.match(new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+p\\.\\s*([^;]+)`, 'i'))?.[1]?.trim() ?? reference.pages
      : reference.pages;
    return { ...reference, pages };
  });
  return {
    answer: record.answer,
    mode: 'SHORT',
    blocks: [],
    sources: [],
    coverage: emptyCoverage(),
    score: 1,
    passages: [],
    ready: true,
    intent: 'DOC_QUESTION',
    provider: 'verified-faq',
    faqId: record.id,
    faqSources,
    faqSuggestions: record.follow_up_suggestions ?? [],
    faqMatchedBy: matchedBy,
  };
}

let localModelPromise: Promise<import('../lib/localModel').LocalModel> | undefined;
async function getLocalModel() {
  localModelPromise ??= import('../lib/localModel').then(({ LocalModel }) => new LocalModel());
  return localModelPromise;
}

export async function prepareLocalModel(onProgress: (text: string, value: number) => void, retry = false) {
  const model = await getLocalModel();
  if (retry) model.resetSessionFailure();
  const { selectLocalModel } = await import('../lib/localModel');
  const modelId = selectLocalModel();
  await model.load(modelId, onProgress);
  return modelId;
}

export async function localModelPlan() {
  const { selectLocalModel, modelInfo } = await import('../lib/localModel');
  const id = selectLocalModel();
  return modelInfo(id);
}
export async function unloadLocalModel() {
  if (localModelPromise) await (await localModelPromise).unload();
}

export async function stopLocalGeneration() {
  if (localModelPromise) await (await localModelPromise).stop();
}

async function generatedAnswer(question: string, history: ConversationTurn[], result: EngineResult, signal?: AbortSignal, onToken?: (text: string) => void): Promise<Pick<EngineResult, 'generatedAnswer' | 'generatedCitations' | 'nextQuestion' | 'fallback' | 'fallbackReason' | 'provider'>> {
  if (result.coverage.type === 'NONE' || !result.passages.length) return { fallback: false, provider: 'none' };
  const evidence = result.passages.slice(0, 6);
  const evidenceText = evidence.map(item => `${item.text} ${(item.tables ?? []).map(table => `${table.heading} ${table.columns.join(' ')} ${table.rows.flat().join(' ')}`).join(' ')}`).join(' ');
  const model = await getLocalModel();
  if (!model.isReady()) return { fallback: true, fallbackReason: 'local_model_not_ready', provider: 'extractive' };
  let stopped = false;
  const stop = () => { stopped = true; void model.stop(); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const answer = await model.ask(question, evidence, history.slice(-6).map(turn => `${turn.role}: ${turn.text}`), onToken, { maxTokens: result.mode === 'DETAILED' ? 420 : 260 });
    if (stopped || signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const withNext = stripNext(answer);
    const parsed = parseCitations(withNext.text, new Set(evidence.map((_item, index) => index + 1)));
    const citationSources = parsed.citations.map(id => { const item = evidence[id - 1]; return { fileName: item.sourceFile, page: item.pageStart, pageEnd: item.pageEnd, sectionTitle: item.sectionTitle }; });
    const grounded = numbersAreGrounded(parsed.text, evidenceText);
    if (!parsed.citations.length || !grounded || hasLongVerbatimCopy(parsed.text, evidenceText)) {
      console.debug('[smart-bot-debug]', { stage: 'local-answer-validation', citationCount: parsed.citations.length, numbersGrounded: grounded });
      return { fallback: true, fallbackReason: 'answer_validation_failed', provider: 'extractive' };
    }
    return { generatedAnswer: parsed.text, generatedCitations: citationSources, nextQuestion: withNext.next, fallback: false, provider: 'local-webllm' };
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    console.debug('[smart-bot-debug]', { stage: 'local-generation', error: error instanceof Error ? error.name : 'unknown' });
    return { fallback: true, fallbackReason: 'local_generation_failed', provider: 'extractive' };
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}

export async function askConversational(input: string, history: ConversationTurn[] = [], signal?: AbortSignal, onToken?: (text: string) => void): Promise<EngineResult> {
  const knowledge = await loadFaqKnowledge();
  const conversationIntent = matchConversationIntent(input, knowledge.intents);
  if (conversationIntent) {
    const conversationalIntent: Intent = conversationIntent.intent === 'greeting' ? 'GREETING' : conversationIntent.intent === 'farewell' ? 'GOODBYE' : conversationIntent.intent === 'thanks' ? 'THANKS' : 'ABOUT_BOT';
    return { ...smallTalkResult(conversationalIntent), answer: conversationIntent.answer, nextQuestion: conversationIntent.follow_up_suggestions[0], faqSuggestions: conversationIntent.follow_up_suggestions, provider: 'conversation-intent' };
  }
  const previousQuestion = [...history].reverse().find(turn => turn.role === 'user')?.text;
  const previousMatch = previousQuestion ? matchFaq(previousQuestion, knowledge.faqs) : undefined;
  const faqMatch = matchFaq(input, knowledge.faqs, previousMatch ? { admissionYear: previousMatch.record.admission_year, category: previousMatch.record.category } : undefined);
  if (faqMatch) return faqResult(faqMatch.record, faqMatch.matchedBy);

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
  return { ...result, intent, rewrittenQuery, ...generated, answer: generated.generatedAnswer ?? result.answer };
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
  const tableDetail = block.tables[0]?.rows.find(row => row[0] && row.slice(1).some(Boolean))?.filter(Boolean).join(': ');
  const sentenceDetail = block.originalText.split(/(?<=[.!?])\s+/).map(cleanText).find(isUsefulAnswerText);
  const detail = block.bullets.find(isUsefulAnswerText) || tableDetail || sentenceDetail;
  return [scope, detail ? cleanText(detail) : 'The retrieved passages do not contain a complete, verified answer to this question.'].filter(Boolean).join(' ');
}

export async function askEngine(query: string): Promise<EngineResult> {
  const question = query.trim().slice(0, 300);
  if (!question) throw new Error('Enter a question.');
  if (isUnsupportedDocumentQuestion(question)) {
    return { answer: CONFIG.OUT_OF_CONTEXT_MESSAGE, mode: detectAnswerMode(question), blocks: [], sources: [], coverage: emptyCoverage(), score: 0, passages: [], ready: true };
  }
  await loadEngine();
  if (!store) throw new Error('Search engine is unavailable.');
  const queryVector = await embed(question);
  const search: SearchResult = store.search(question, queryVector, CONFIG.TOP_K);
  const analysis = analyzeQuery(question);
  const termPages = store.getTermPages();
  const routedResults = search.results.filter(item => item.routingBoost > 0);
  const scopedResults = routedResults.length ? routedResults : search.results;
  const scopedTopScore = scopedResults.reduce((best, item) => Math.max(best, item.score), 0);
  const topText = scopedResults.map(item => item.text).join(' ');
  const hasKnownUnqualifiedTerm = analysis.topic === null && (analysis.aspects.includes('hostel') || analysis.aspects.every(aspect => aspect.split(/[_\s-]+/).some(term => Boolean(termPages[term.toLowerCase()]?.length))));
  const coverage = !hasKnownUnqualifiedTerm && analysis.topic === null
    ? evaluateCoverage({ ...analysis, aspects: [] }, topText, termPages, Math.min(scopedTopScore, 0.19))
    : evaluateCoverage(analysis, topText, termPages, scopedTopScore);
  const mode = detectAnswerMode(question);
  if (coverage.type === 'NONE' || !scopedResults.length) return { answer: CONFIG.OUT_OF_CONTEXT_MESSAGE, mode, blocks: [], sources: [], coverage, score: scopedTopScore, passages: scopedResults, ready: true };

  const hit = scopedResults[0];
  const sectionChunks = store.expandSection(hit.sectionTitle, hit.sourceFile, 900);
  const nearby = sectionChunks
    .map((chunk, index) => ({ chunk, distance: Math.abs(index - sectionChunks.findIndex(item => item.id === hit.id)) }))
    .sort((a, b) => a.distance - b.distance)
    .map(item => item.chunk);
  const evidenceChunks = [hit, ...scopedResults, ...nearby]
    .filter((chunk, index, all) => all.findIndex(item => item.id === chunk.id) === index)
    .slice(0, 6);
  const expandedScored: ScoredChunk[] = evidenceChunks.map(chunk => {
    const original = scopedResults.find(item => item.id === chunk.id);
    return { ...chunk, embeddingScore: original?.embeddingScore ?? hit.embeddingScore, bm25Score: original?.bm25Score ?? hit.bm25Score, routingBoost: original?.routingBoost ?? hit.routingBoost, score: original?.score ?? hit.score };
  });
  const candidates = extractCandidateSentences(expandedScored);
  const candidateVectors = candidates.length ? await embedBatch(candidates.map(item => item.text)) : new Float32Array();
  const bullets = candidates.length ? scoreAndSelectBullets(question, queryVector, candidates, candidateVectors, 384) : [];
  const block = makeBlock(hit, expandedScored, bullets, mode);
  const answer = summaryFor(block, coverage);
  console.debug('[smart-bot-debug]', { query: question, top: scopedResults.slice(0, 3).map(item => ({ file: item.sourceFile, page: item.pageStart, embedding: Number(item.embeddingScore.toFixed(3)), bm25: Number(item.bm25Score.toFixed(3)), score: Number(item.score.toFixed(3)) })), coverage: coverage.type, evidence: expandedScored.map(item => ({ file: item.sourceFile, page: item.pageStart, section: item.sectionTitle })) });
  const source: EngineSource = { fileName: block.sourceFile, page: block.pageStart, pageEnd: block.pageEnd, sectionTitle: block.sectionTitle };
  return { answer, mode, blocks: [block], sources: [source], coverage, score: scopedTopScore, passages: expandedScored, ready: true };
}
