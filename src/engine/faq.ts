export type FaqSourceReference = { file: string; pages: string; admission_year: string };
export type FaqRecord = {
  id: string; question: string; answer: string; category: string; keywords: string;
  source_files: string[]; source_pages: string[]; admission_year: string;
  intent_type: 'factual_faq'; canonical_question?: string; alternative_questions?: string[];
  follow_up_suggestions?: string[]; source_references?: FaqSourceReference[]; display_source?: string;
};
export type ConversationIntent = {
  id: string; intent_type: 'conversational'; intent: string; trigger_phrases: string[];
  answer: string; category: string; keywords: string[]; follow_up_suggestions: string[];
  context_action: string; source_files: string[]; source_pages: string[]; admission_year: string;
};
export type FaqKnowledge = { faqs: FaqRecord[]; intents: ConversationIntent[]; config: Record<string, unknown> };
export type FaqContext = { admissionYear?: string; family?: 'bitsat' | 'first-degree' | 'higher-degree'; category?: string };
export type FaqMatch = { record: FaqRecord; score: number; matchedBy: 'exact' | 'alias' | 'keywords' };
export type FaqRetrieval = { match?: FaqMatch; candidates: FaqMatch[]; needsClarification: boolean; reason: string; normalizedQuery: string };

const STOP_WORDS = new Set('a an and are as at be can could did do does for from had has have how i in is it me my no of on or our please tell that the their them there these they this those to was were what when where which who why with would about explain give important'.split(' '));
const TERM_GROUPS: Record<string, string[]> = {
  bitsat: ['bit', 'bits', 'bit-sat', 'bitsat', 'bitsat-2026'],
  higherdegree: ['higher', 'higher-degree', 'higher degree', 'hd', 'higher-degree admissions'],
  firstdegree: ['first', 'first-degree', 'first degree', 'fd', 'integrated first degree', 'undergraduate'],
  eligibility: ['eligible', 'eligibility', 'eligibilities', 'qualified', 'qualify', 'qualification', 'qualifications', 'criteria', 'criterion', 'requirement', 'requirements', 'minimum marks', 'cutoff', 'cut-off'],
  fee: ['fees', 'fee', 'cost', 'costs', 'charge', 'charges', 'tuition', 'payment', 'payments', 'amount', 'price'],
  date: ['dates', 'date', 'deadline', 'deadlines', 'due', 'schedule', 'timeline', 'when', 'important dates', 'last date'],
  scholarship: ['scholarships', 'scholarship', 'financial assistance', 'stipend', 'waiver', 'fellowship'],
  program: ['program', 'programs', 'programme', 'programmes', 'course', 'courses'],
};
const TERM_TO_CONCEPT = new Map(Object.entries(TERM_GROUPS).flatMap(([concept, forms]) => forms.map(form => [normalizeRaw(form), concept] as const)));

function normalizeRaw(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/bit\s*[- ]?sat/g, 'bitsat').replace(/m\s*\.\s*e\s*\.?/g, 'me')
    .replace(/m\s*\.\s*pharm\s*\.?/g, 'mpharm').replace(/first[\s-]+degree/g, 'firstdegree')
    .replace(/higher[\s-]+degree/g, 'higherdegree').replace(/20\s*[-/]?\s*(\d{2})/g, '20$1')
    .replace(/\bimportant\s+dates?\b/g, 'date')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function conceptToken(token: string): string {
  const direct = TERM_TO_CONCEPT.get(token);
  if (direct) return direct;
  if (token.length > 4 && token.endsWith('ies')) return conceptToken(`${token.slice(0, -3)}y`);
  if (token.length > 4 && token.endsWith('s')) return conceptToken(token.slice(0, -1));
  return token;
}

export function normalizeFaqText(value: string): string {
  return normalizeRaw(value).split(' ').map(conceptToken).filter(Boolean).join(' ');
}

export function tokens(value: string): string[] {
  return normalizeFaqText(value).split(' ').filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

export function parseFaqContextSelection(input: string): FaqContext | undefined {
  const normalized = normalizeFaqText(input);
  const rawLower = input.toLowerCase();
  const yearMatches = [...rawLower.matchAll(/\b(20\d{2})(?:\s*[-/]?\s*(\d{2}))?\b/g)];
  let admissionYear = yearMatches.length === 1
    ? (yearMatches[0][2] ? `${yearMatches[0][1]}-${yearMatches[0][2]}` : `${yearMatches[0][1]}-${String(Number(yearMatches[0][1].slice(-2)) + 1).padStart(2, '0')}`)
    : undefined;

  const isMeDegree = /\bm\.\s*e\.?\b/i.test(input) || /\bME\b/.test(input) || /\bme\s+(?:degree|programme|program|fee|fees|cost|eligib|admission|course|computer|software|chemical|civil|biotech)/i.test(input);
  const hasHd = normalized.includes('higherdegree') || /\bhd\b/.test(normalized) || normalized.includes('mpharm') || normalized.includes('phd') || isMeDegree;
  const hasFd = normalized.includes('firstdegree') || normalized.includes('undergraduate') || normalized.includes('board topper') || /\bfd\b/.test(rawLower);
  const hasBitsat = normalized.includes('bitsat');
  const familyCount = Number(hasHd) + Number(hasFd) + Number(hasBitsat);
  const family: FaqContext['family'] = familyCount === 1 ? (hasHd ? 'higher-degree' : hasFd ? 'first-degree' : 'bitsat') : undefined;

  if (!admissionYear && family === 'bitsat') admissionYear = '2026-27';
  if (!admissionYear && family === 'higher-degree') admissionYear = '2025-26';
  if (!admissionYear && family === 'first-degree') admissionYear = '2022-23';

  const category = inferFaqCategory(input);
  if (!admissionYear && !family && !category) return undefined;
  return { ...(admissionYear && { admissionYear }), ...(family && { family }), ...(category && { category }) };
}

export function isFaqContextSelection(input: string): boolean {
  const clean = input.trim().replace(/^(specify|select|switch to|use) /i, '').trim();
  if (/^bitsat(?:[- ]?2026(?:[- ]?27)?)?$/i.test(clean)) return true;
  if (/^(?:higher[- ]?degree|hd)(?:[- ]?admissions?)?(?:[- ]?2025(?:[- ]?26)?)?$/i.test(clean)) return true;
  if (/^(?:first[- ]?degree|fd)(?:[- ]?admissions?)?(?:[- ]?2022(?:[- ]?23)?)?$/i.test(clean)) return true;
  const normalized = normalizeFaqText(clean);
  return /^(bitsat|higherdegree|firstdegree|eligibility|fee|date|scholarship|program|syllabus)$/.test(normalized);
}

export function inferFaqCategory(input: string): string | undefined {
  const normalized = normalizeFaqText(input);
  if (normalized.includes('eligibility')) return 'eligibility';
  if (normalized.includes('fee')) return 'fees';
  if (normalized.includes('date') || /\b(timeline|schedule|deadline)\b/.test(normalized)) return 'dates';
  if (normalized.includes('scholarship') || /\b(stipend|financial assistance|waiver)\b/.test(normalized)) return 'scholarships';
  if (normalized.includes('program')) return 'programmes';
  if (/\b(syllabus|subject|curriculum)\b/.test(normalized)) return 'syllabus';
  return undefined;
}

export function familyOfFaqRecord(record: FaqRecord): FaqContext['family'] {
  if (/BITSAT-2026/i.test(record.id) || record.admission_year === '2026-27') return 'bitsat';
  if (/BITS-HD|higher.?degree/i.test(record.id) || record.admission_year === '2025-26') return 'higher-degree';
  if (/FD-Admission|first.?degree/i.test(record.id) || record.admission_year === '2022-23') return 'first-degree';
  return undefined;
}

export function recordTerms(record: FaqRecord): string[] {
  return tokens([record.question, record.canonical_question ?? '', ...(record.alternative_questions ?? []), record.category, record.keywords].join(' '));
}

export function scoreCandidate(queryTokens: string[], candidateTokens: string[], documentFrequency: Map<string, number>, documentCount: number): number {
  const queryUnique = [...new Set(queryTokens)];
  if (!queryUnique.length || !candidateTokens.length) return 0;
  const candidateSet = new Set(candidateTokens);
  let totalWeight = 0;
  let matchedWeight = 0;
  let matchedCount = 0;
  for (const token of queryUnique) {
    const weight = 1 + Math.log((documentCount + 1) / ((documentFrequency.get(token) ?? 0) + 1));
    totalWeight += weight;
    if (candidateSet.has(token)) {
      matchedWeight += weight;
      matchedCount++;
    }
  }
  if (queryUnique.length >= 3 && matchedCount < 2) return 0;
  if (queryUnique.length >= 2 && matchedCount === 1 && matchedWeight / totalWeight < 0.45) return 0;
  const recall = matchedWeight / totalWeight;
  const precision = matchedWeight / [...candidateSet].reduce((sum, token) => sum + (queryUnique.includes(token) ? 1 + Math.log((documentCount + 1) / ((documentFrequency.get(token) ?? 0) + 1)) : 0.25), 0);
  return Math.min(1, recall * 0.72 + precision * 0.28);
}

function validFaq(value: unknown): value is FaqRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<FaqRecord>;
  return r.intent_type === 'factual_faq' && typeof r.id === 'string' && Boolean(r.id.trim()) &&
    typeof r.question === 'string' && Boolean(r.question.trim()) && typeof r.answer === 'string' && Boolean(r.answer.trim()) &&
    typeof r.category === 'string' && Boolean(r.category.trim()) && typeof r.keywords === 'string' &&
    typeof r.admission_year === 'string' && Boolean(r.admission_year.trim()) && Array.isArray(r.source_files) && r.source_files.length > 0 &&
    r.source_files.every(file => typeof file === 'string' && Boolean(file.trim())) && Array.isArray(r.source_pages) && r.source_pages.length > 0 &&
    r.source_pages.every(page => typeof page === 'string' && Boolean(page.trim())) &&
    (!r.source_references || (Array.isArray(r.source_references) && r.source_references.every(source => source && typeof source.file === 'string' && typeof source.pages === 'string' && typeof source.admission_year === 'string')));
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
  const text = await response.text();
  return text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line) as T; } catch { throw new Error(`Invalid JSON on line ${index + 1} of ${path}.`); }
  });
}

let knowledgePromise: Promise<FaqKnowledge> | undefined;
export function loadFaqKnowledge(): Promise<FaqKnowledge> {
  if (knowledgePromise) return knowledgePromise;
  const base = `${import.meta.env?.BASE_URL ?? '/'}data/`;
  knowledgePromise = Promise.all([
    readJsonl<unknown>(`${base}faq_dataset.jsonl`), readJsonl<ConversationIntent>(`${base}chatbot_intents.jsonl`),
    fetch(`${base}chatbot_config.json`).then(response => { if (!response.ok) throw new Error(`Could not load chatbot configuration (${response.status}).`); return response.json() as Promise<Record<string, unknown>>; }),
  ]).then(([rawFaqs, intents, config]) => {
    if (rawFaqs.some(record => !validFaq(record))) throw new Error(`The verified FAQ dataset has ${rawFaqs.filter(validFaq).length} valid records and contains malformed records.`);
    const faqs = rawFaqs as FaqRecord[];
    if (faqs.length !== 1000) throw new Error(`The FAQ dataset has ${faqs.length} records; 1,000 were expected.`);
    if (new Set(faqs.map(record => record.id)).size !== faqs.length) throw new Error('The FAQ dataset contains duplicate IDs.');
    if (new Set(faqs.map(record => record.question.toLowerCase())).size !== faqs.length) throw new Error('The FAQ dataset contains duplicate question strings.');
    if (!intents.some(intent => intent.intent === 'greeting') || !intents.some(intent => intent.intent === 'unknown_question')) throw new Error('Conversational intents are incomplete.');
    return { faqs, intents, config };
  }).catch(error => { knowledgePromise = undefined; throw error; });
  return knowledgePromise;
}

export function matchConversationIntent(input: string, intents: ConversationIntent[]): ConversationIntent | undefined {
  const normalized = normalizeFaqText(input);
  if (!normalized) return undefined;
  return intents.find(intent => intent.trigger_phrases.some(phrase => normalizeFaqText(phrase) === normalized));
}

export function retrieveFaq(input: string, faqs: FaqRecord[], context: FaqContext = {}): FaqRetrieval {
  const normalizedQuery = normalizeFaqText(input);
  const queryTokens = tokens(input);
  const queryContext = parseFaqContextSelection(input);
  const filters: FaqContext = { ...context, ...queryContext };
  const inferredCategory = inferFaqCategory(input);
  const targetCategory = filters.category ?? inferredCategory;

  const pool = faqs.filter(record => {
    if (filters.admissionYear && record.admission_year !== filters.admissionYear && record.admission_year !== 'Multiple cycles') return false;
    if (filters.family && familyOfFaqRecord(record) !== filters.family && record.admission_year !== 'Multiple cycles') return false;
    return true;
  });
  if (!pool.length) return { candidates: [], needsClarification: false, reason: 'no_candidates_after_context_filter', normalizedQuery };

  const exact: FaqMatch[] = [];
  for (const record of pool) {
    const forms = [record.question, record.canonical_question ?? '', ...(record.alternative_questions ?? [])].filter(Boolean);
    const exactQuestion = normalizeFaqText(record.question) === normalizedQuery;
    const exactForm = forms.some(form => normalizeFaqText(form) === normalizedQuery);
    if (exactForm) exact.push({ record, score: exactQuestion ? 1 : 0.995, matchedBy: exactQuestion ? 'exact' : 'alias' });
  }
  if (exact.length) {
    exact.sort((a, b) => Number(b.matchedBy === 'exact') - Number(a.matchedBy === 'exact'));
    return { match: exact[0], candidates: exact.slice(0, 5), needsClarification: false, reason: 'exact_question_or_alias', normalizedQuery };
  }

  const docs = pool.map(recordTerms);
  const documentFrequency = new Map<string, number>();
  for (const document of docs) for (const token of new Set(document)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);

  const ranked: FaqMatch[] = pool.map((record, index) => {
    let score = scoreCandidate(queryTokens, docs[index], documentFrequency, docs.length);
    if (score > 0 && targetCategory && record.category.toLowerCase().includes(targetCategory === 'fees' ? 'fee' : targetCategory === 'programmes' ? 'program' : targetCategory)) {
      score += 0.08;
    }
    if (score > 0 && filters.family && familyOfFaqRecord(record) === filters.family) {
      score += 0.05;
    }
    return { record, score: Math.min(1, score), matchedBy: 'keywords' as const };
  });

  ranked.sort((a, b) => b.score - a.score);
  const candidates = ranked.slice(0, 8);
  const best = candidates[0];

  const broadMultiProgrammeQuery = !filters.family && !filters.admissionYear && (
    (Boolean(targetCategory) && new Set(queryTokens).size <= 3) ||
    /\b(eligib|fee|cost|charge|date|deadline|schedule|timeline|qualif|requirement)\b/i.test(input)
  ) && !/\b(bitsat|hd|m\.e\.?|b\.e\.?|mpharm|phd|topper|12th|first degree|higher degree)\b/i.test(input);

  const qualifyingCandidates = candidates.filter(c => c.score >= 0.2);
  const availableFamilies = [...new Set(qualifyingCandidates.map(c => familyOfFaqRecord(c.record)).filter(Boolean))];

  if (broadMultiProgrammeQuery && (availableFamilies.length > 1 || qualifyingCandidates.length >= 2)) {
    return { candidates, needsClarification: true, reason: 'multiple_admission_programmes_are_equally_relevant', normalizedQuery };
  }

  const topicOnly = Boolean(targetCategory) && new Set(queryTokens).size <= 2;
  const threshold = topicOnly ? 0.24 : 0.40;
  if (!best || best.score < threshold) {
    return { candidates, needsClarification: false, reason: 'below_confidence_threshold', normalizedQuery };
  }

  if (!filters.family && !filters.admissionYear && availableFamilies.length > 1 && best.score - (candidates.find(c => familyOfFaqRecord(c.record) !== familyOfFaqRecord(best.record))?.score ?? 0) < 0.06) {
    return { candidates, needsClarification: true, reason: 'multiple_admission_programmes_are_equally_relevant', normalizedQuery };
  }

  return { match: best, candidates, needsClarification: false, reason: 'top_candidate_above_threshold', normalizedQuery };
}

export function matchFaq(input: string, faqs: FaqRecord[], context?: FaqContext): FaqMatch | undefined {
  return retrieveFaq(input, faqs, context).match;
}

export function clearFaqKnowledgeCache() { knowledgePromise = undefined; }

