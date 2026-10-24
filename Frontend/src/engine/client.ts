import { CONFIG, detectAnswerMode, type AnswerMode } from './config.ts';
import { cleanText, extractCandidateSentences, isUsefulAnswerText, scoreAndSelectBullets, type BulletItem } from './answer.ts';
import { analyzeQuery, evaluateCoverage, isUnsupportedDocumentQuestion, type CoverageDecision } from './queryAnalysis.ts';
import { VectorStore } from './search.ts';
import type { ScoredChunk, SearchResult, TableData } from './types.ts';
import { tableNumbersAreGrounded } from './tables.ts';
import { classifyIntent, rewriteFollowup, sanitizeMarkdown, smallTalkReply, STARTER_CHIPS, type ConversationTurn, type Intent } from './conversation';
import { familyOfFaqRecord, inferFaqCategory, isFaqContextSelection, loadFaqKnowledge, matchConversationIntent, normalizeFaqText, parseFaqContextSelection, retrieveFaq, type FaqContext, type FaqRecord, type FaqSourceReference } from './faq';

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
  faqIds?: string[];
  diagnostics?: { normalizedQuery: string; selectedIntent: string; topCandidates: Array<{ id: string; score: number }>; threshold: number; fallbackReason: string };
};

function emptyCoverage(): CoverageDecision { return { type: 'NONE', topic: null, missingAspect: null, presentAspect: null, limitationMessage: null, scopeNote: null, suggestedQuestions: STARTER_CHIPS, disambiguationChips: [] }; }

function smallTalkResult(intent: Intent): EngineResult {
  return { answer: smallTalkReply(intent as Exclude<Intent, 'DOC_QUESTION' | 'FOLLOWUP' | 'CHITCHAT' | 'UNSAFE'>), mode: 'SHORT', blocks: [], sources: [], coverage: emptyCoverage(), score: 0, passages: [], ready: true, intent };
}

function faqResult(record: FaqRecord, matchedBy: 'exact' | 'alias' | 'keywords', suggestions: string[] = []): EngineResult {
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
    faqSuggestions: suggestions,
    faqMatchedBy: matchedBy,
  };
}

function contextFromHistory(history: ConversationTurn[]): FaqContext {
  const context: FaqContext = {};
  for (const turn of history) {
    if (turn.role !== 'user') continue;
    const parsed = parseFaqContextSelection(turn.text);
    if (parsed && (isFaqContextSelection(turn.text) || turn.text.includes('?'))) Object.assign(context, parsed);
  }
  return context;
}

function relevantSuggestions(record: FaqRecord, faqs: FaqRecord[]): string[] {
  const family = familyOfFaqRecord(record);
  const seen = new Set([record.canonical_question || record.question, record.question]);
  const suggestions: string[] = [];

  for (const candidate of faqs) {
    if (candidate.id === record.id || candidate.answer === record.answer) continue;
    if (family && familyOfFaqRecord(candidate) !== family) continue;
    if (candidate.category !== record.category) continue;
    const prompt = candidate.canonical_question || candidate.question;
    if (seen.has(prompt)) continue;
    seen.add(prompt);
    suggestions.push(prompt);
    if (suggestions.length === 3) break;
  }

  if (suggestions.length < 3 && family) {
    const fallbackCategories = ['dates', 'eligibility', 'fees', 'programmes', 'scholarships', 'admission-modes'];
    for (const cat of fallbackCategories) {
      if (cat === record.category) continue;
      const candidate = faqs.find(c => familyOfFaqRecord(c) === family && (c.category === cat || c.category.includes(cat)) && !seen.has(c.canonical_question || c.question));
      if (candidate) {
        const prompt = candidate.canonical_question || candidate.question;
        seen.add(prompt);
        suggestions.push(prompt);
        if (suggestions.length === 3) break;
      }
    }
  }

  return suggestions.slice(0, 3);
}

function contextSelectionResult(input: string, context: FaqContext): EngineResult {
  const choice = [context.family === 'bitsat' ? 'BITSAT' : context.family === 'higher-degree' ? 'Higher-Degree admissions' : context.family === 'first-degree' ? 'First-Degree admissions' : '', context.admissionYear].filter(Boolean).join(' ');
  const category = context.category ? ` in ${context.category.replaceAll('-', ' ')}` : '';
  return { ...smallTalkResult('ABOUT_BOT'), answer: `Okay, I’ll use ${choice || context.category || 'that topic'}${category} as context. What would you like to know?`, provider: 'context-selection', faqSuggestions: ['What are the eligibility requirements?', 'What are the fees?', 'What are the important dates?'], diagnostics: { normalizedQuery: input, selectedIntent: 'context_selection', topCandidates: [], threshold: 0.42, fallbackReason: 'context_updated' } };
}

function compositeFaqResult(records: FaqRecord[], suggestions: string[]): EngineResult {
  const unique = [...new Map(records.map(record => [record.answer, record])).values()];
  const refs = unique.flatMap(record => record.source_references ?? record.source_files.map((file, index) => ({ file, pages: record.source_pages[index] ?? '?', admission_year: record.admission_year })));
  const faqSources = [...new Map(refs.map(reference => [`${reference.file}|${reference.pages}|${reference.admission_year}`, reference])).values()];
  return { answer: unique.map(record => `• ${record.answer}`).join('\n'), mode: 'SHORT', blocks: [], sources: [], coverage: emptyCoverage(), score: 1, passages: [], ready: true, intent: 'DOC_QUESTION', provider: 'verified-faq', faqId: unique[0]?.id, faqIds: unique.map(record => record.id), faqSources, faqSuggestions: suggestions, faqMatchedBy: 'keywords' };
}

function logRetrieval(result: EngineResult) {
  if (import.meta.env.DEV && result.diagnostics) console.debug('[bot-retrieval]', result.diagnostics);
}

export async function askConversational(input: string, history: ConversationTurn[] = [], signal?: AbortSignal, onToken?: (text: string) => void): Promise<EngineResult> {
  void onToken;
  const knowledge = await loadFaqKnowledge();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const activeContext = contextFromHistory(history);
  const parsedSelection = parseFaqContextSelection(input);
  if (parsedSelection && isFaqContextSelection(input)) {
    const mergedContext: FaqContext = { ...activeContext, ...parsedSelection };
    const lastUserTurn = [...history].reverse().find(turn => turn.role === 'user' && !isFaqContextSelection(turn.text));
    if (lastUserTurn) {
      const prevQuery = lastUserTurn.text;
      const prevCategory = parsedSelection.category ?? inferFaqCategory(prevQuery) ?? activeContext.category;
      const broadCategory = prevCategory && mergedContext.family && /\b(eligib|fee|cost|charge|date|deadline|scholarship)\w*\b/i.test(prevQuery);
      if (broadCategory && prevCategory !== 'dates') {
        const records = knowledge.faqs.filter(record => (!mergedContext.admissionYear || record.admission_year === mergedContext.admissionYear) && (!mergedContext.family || familyOfFaqRecord(record) === mergedContext.family))
          .filter(record => record.category === prevCategory || (prevCategory === 'fees' && record.category.includes('fee')) || (prevCategory === 'eligibility' && record.category.includes('eligib')))
          .filter(record => record.intent_type === 'factual_faq');
        if (records.length) {
          const prompts = relevantSuggestions(records[0], knowledge.faqs);
          const result = compositeFaqResult(records, prompts);
          result.diagnostics = { normalizedQuery: normalizeFaqText(input), selectedIntent: `context_resolved_${prevCategory}`, topCandidates: records.slice(0, 5).map(record => ({ id: record.id, score: 1 })), threshold: 0.42, fallbackReason: 'answered_pending_question_with_selected_context' };
          logRetrieval(result); return result;
        }
      }
      const prevRetrieval = retrieveFaq(prevQuery, knowledge.faqs, mergedContext);
      if (prevRetrieval.match) {
        const record = prevRetrieval.match.record;
        const result = faqResult(record, prevRetrieval.match.matchedBy, relevantSuggestions(record, knowledge.faqs));
        result.diagnostics = { normalizedQuery: prevRetrieval.normalizedQuery, selectedIntent: 'factual_faq', topCandidates: prevRetrieval.candidates.slice(0, 5).map(c => ({ id: c.record.id, score: c.score })), threshold: 0.42, fallbackReason: 'answered_pending_question_with_selected_context' };
        logRetrieval(result); return result;
      }
    }
    const selected = contextSelectionResult(input, mergedContext);
    logRetrieval(selected); return selected;
  }
  const conversationIntent = matchConversationIntent(input, knowledge.intents);
  if (conversationIntent) {
    if (conversationIntent.intent === 'category_navigation') {
      const result = { ...smallTalkResult('ABOUT_BOT'), answer: conversationIntent.answer, faqSuggestions: conversationIntent.follow_up_suggestions, provider: 'conversation-intent' };
      logRetrieval(result); return result;
    }
    if (conversationIntent.intent === 'category_selection') {
      const result = contextSelectionResult(input, { ...activeContext, ...(parsedSelection ?? {}) });
      logRetrieval(result); return result;
    }
    const conversationalIntent: Intent = conversationIntent.intent === 'greeting' ? 'GREETING' : conversationIntent.intent === 'farewell' ? 'GOODBYE' : conversationIntent.intent === 'thanks' ? 'THANKS' : 'ABOUT_BOT';
    const result = { ...smallTalkResult(conversationalIntent), answer: conversationIntent.answer, nextQuestion: conversationIntent.follow_up_suggestions[0], faqSuggestions: conversationIntent.follow_up_suggestions.filter(suggestion => !/^show categories$/i.test(suggestion)), provider: 'conversation-intent' };
    logRetrieval(result); return result;
  }
  const queryContext = { ...activeContext, ...parsedSelection };
  const requestedCategory = parsedSelection?.category ?? inferFaqCategory(input) ?? activeContext.category;
  const broadCategory = requestedCategory && queryContext.family && /\b(eligib|fee|cost|charge|date|deadline|scholarship)\w*\b/i.test(input);
  const hasNarrowQualifier = /\b(75\s*%|60\s*%|pcm|pcb|session\s*[12]|application fee|test fee|tuition|refund|refundable|stipend|scholarship|gate|gpat|deadline|last date|reporting|orientation|editing window|class 10|passing year|improvement|dubai|nepal|female|male)\b/i.test(input);
  if (broadCategory && !hasNarrowQualifier && requestedCategory !== 'dates') {
    const records = knowledge.faqs.filter(record => (!queryContext.admissionYear || record.admission_year === queryContext.admissionYear) && (!queryContext.family || familyOfFaqRecord(record) === queryContext.family))
      .filter(record => record.category === requestedCategory || (requestedCategory === 'fees' && record.category.includes('fee')) || (requestedCategory === 'eligibility' && record.category.includes('eligib')))
      .filter(record => record.intent_type === 'factual_faq');
    if (records.length) {
      const prompts = relevantSuggestions(records[0], knowledge.faqs);
      const result = compositeFaqResult(records, prompts);
      result.diagnostics = { normalizedQuery: normalizeFaqText(input), selectedIntent: `broad_${requestedCategory}_summary`, topCandidates: records.slice(0, 5).map(record => ({ id: record.id, score: 1 })), threshold: 0.42, fallbackReason: `combined_distinct_${requestedCategory}_answers_for_selected_admission_route` };
      logRetrieval(result); return result;
    }
  }
  const retrieval = retrieveFaq(input, knowledge.faqs, queryContext);
  const broadBitsatDates = queryContext.family === 'bitsat' && queryContext.admissionYear === '2026-27' && /\b(date|dates|deadline|deadlines|timeline|schedule)\b/i.test(input) && !/session\s*[12]|application window|start date|deadline for/i.test(input);
  if (broadBitsatDates) {
    const dates = knowledge.faqs.filter(record => record.admission_year === '2026-27' && record.category === 'dates');
    const result = compositeFaqResult(dates, [...new Set(dates.map(record => record.canonical_question || record.question))].slice(0, 3));
    result.diagnostics = { normalizedQuery: retrieval.normalizedQuery, selectedIntent: 'broad_faq_date_summary', topCandidates: retrieval.candidates.slice(0, 5).map(candidate => ({ id: candidate.record.id, score: candidate.score })), threshold: 0.24, fallbackReason: 'combined_all_distinct_date_answers_for_requested_cycle' };
    logRetrieval(result); return result;
  }
  if (retrieval.needsClarification) {
    const years = [...new Set(retrieval.candidates.map(candidate => candidate.record.admission_year))];
    const suggestions = years.includes('2022-23') ? ['BITSAT-2026', 'First-Degree admissions 2022-23', 'Higher-Degree admissions 2025-26'] : ['BITSAT-2026', 'Higher-Degree admissions 2025-26'];
    const result = { ...smallTalkResult('ABOUT_BOT'), answer: 'Which admission route do you mean? These documents cover different programmes and years.', faqSuggestions: suggestions, provider: 'clarification', diagnostics: { normalizedQuery: retrieval.normalizedQuery, selectedIntent: 'ambiguous_factual_query', topCandidates: retrieval.candidates.slice(0, 5).map(candidate => ({ id: candidate.record.id, score: candidate.score })), threshold: 0.42, fallbackReason: retrieval.reason } };
    logRetrieval(result); return result;
  }
  if (retrieval.match) {
    const record = retrieval.match.record;
    const result = faqResult(record, retrieval.match.matchedBy, relevantSuggestions(record, knowledge.faqs));
    result.diagnostics = { normalizedQuery: retrieval.normalizedQuery, selectedIntent: 'factual_faq', topCandidates: retrieval.candidates.slice(0, 5).map(candidate => ({ id: candidate.record.id, score: candidate.score })), threshold: retrieval.match.matchedBy === 'exact' || retrieval.match.matchedBy === 'alias' ? 0.995 : 0.42, fallbackReason: retrieval.reason };
    logRetrieval(result); return result;
  }

  const intent = classifyIntent(input);
  if (intent === 'GREETING' || intent === 'THANKS' || intent === 'GOODBYE' || intent === 'ABOUT_BOT') return { ...smallTalkResult(intent), nextQuestion: STARTER_CHIPS[0] };
  if (intent === 'UNSAFE') return { ...smallTalkResult('ABOUT_BOT'), answer: 'I can’t follow instructions that try to override my safeguards. I can help with the official BITS admissions documents.', intent };
  if (intent === 'CHITCHAT') return { ...smallTalkResult('ABOUT_BOT'), answer: 'That’s outside what I can help with. I can answer questions about BITS admissions, for example: BITSAT 2026 dates, First Degree eligibility, or Higher Degree fees.', intent };
  const rewrittenQuery = intent === 'FOLLOWUP' ? rewriteFollowup(input, history) : input.trim().slice(0, 300);
  const result = await askEngine(rewrittenQuery);
  if (result.coverage.disambiguationChips.length > 0) {
    return { ...result, intent, rewrittenQuery, blocks: [], sources: [], passages: [], answer: 'Which programme or admission scheme do you mean?', provider: 'none', fallback: false };
  }
  // Retrieval is extractive and cited; it never invokes local-model generation.
  const final = { ...result, intent, rewrittenQuery, provider: result.provider ?? 'retrieval', fallback: false, diagnostics: { normalizedQuery: retrieval.normalizedQuery, selectedIntent: intent, topCandidates: retrieval.candidates.slice(0, 5).map(candidate => ({ id: candidate.record.id, score: candidate.score })), threshold: 0.42, fallbackReason: 'no_reliable_faq_match_document_search_used' } };
  logRetrieval(final);
  return final;
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
