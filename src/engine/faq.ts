export type FaqSourceReference = {
  file: string;
  pages: string;
  admission_year: string;
};

export type FaqRecord = {
  id: string;
  question: string;
  answer: string;
  category: string;
  keywords: string;
  source_files: string[];
  source_pages: string[];
  admission_year: string;
  intent_type: 'factual_faq';
  canonical_question?: string;
  alternative_questions?: string[];
  follow_up_suggestions?: string[];
  source_references?: FaqSourceReference[];
  display_source?: string;
};

export type ConversationIntent = {
  id: string;
  intent_type: 'conversational';
  intent: string;
  trigger_phrases: string[];
  answer: string;
  category: string;
  keywords: string[];
  follow_up_suggestions: string[];
  context_action: string;
  source_files: string[];
  source_pages: string[];
  admission_year: string;
};

export type FaqKnowledge = {
  faqs: FaqRecord[];
  intents: ConversationIntent[];
  config: Record<string, unknown>;
};

export type FaqMatch = {
  record: FaqRecord;
  score: number;
  matchedBy: 'exact' | 'alias' | 'keywords';
};

const STOP_WORDS = new Set('a an and are be can does for from how i in is me of on or tell the to what when where which who with about do explain please'.split(' '));
const TOKEN_ALIASES: Record<string, string> = {
  'bit': 'bitsat', 'bits': 'bitsat', 'bit-sat': 'bitsat', 'bitsat': 'bitsat',
  'm.e': 'me', 'm.e.': 'me', 'm.pharm': 'mpharm', 'm.pharm.': 'mpharm',
  'higher-degree': 'higherdegree', 'higher': 'higherdegree',
  'first-degree': 'firstdegree', 'first': 'firstdegree',
  'programme': 'program', 'programmes': 'program', 'programs': 'program',
  'centres': 'center', 'centre': 'center', 'centers': 'center',
  'scholarships': 'scholarship', 'fees': 'fee', 'dates': 'date',
};

function normalizeToken(token: string): string {
  const lowered = token.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  if (TOKEN_ALIASES[lowered]) return TOKEN_ALIASES[lowered];
  if (lowered.length > 4 && lowered.endsWith('ies')) return `${lowered.slice(0, -3)}y`;
  if (lowered.length > 4 && lowered.endsWith('s')) return lowered.slice(0, -1);
  return lowered;
}

export function normalizeFaqText(value: string): string {
  return value
    .toLowerCase()
    .replace(/bit\s*[- ]?sat/g, 'bitsat')
    .replace(/m\s*\.\s*e\s*\.?/g, 'me')
    .replace(/m\s*\.\s*pharm\s*\.?/g, 'mpharm')
    .replace(/first\s+degree/g, 'firstdegree')
    .replace(/higher\s+degree/g, 'higherdegree')
    .replace(/20\s*(\d{2})/g, '20$1')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean)
    .join(' ');
}

function tokens(value: string): string[] {
  return normalizeFaqText(value).split(' ').filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function tokenSet(value: string): Set<string> { return new Set(tokens(value)); }

function similarity(query: string, candidate: string): number {
  const q = tokenSet(query);
  const c = tokenSet(candidate);
  if (!q.size || !c.size) return 0;
  let overlap = 0;
  q.forEach(token => { if (c.has(token)) overlap += 1; });
  const recall = overlap / q.size;
  const precision = overlap / c.size;
  return (recall * 0.72) + (precision * 0.28);
}

function validFaq(value: unknown): value is FaqRecord {
  const record = value as Partial<FaqRecord> | null;
  return Boolean(record && record.intent_type === 'factual_faq' && record.id && record.question && record.answer && record.category && Array.isArray(record.source_files) && Array.isArray(record.source_pages) && record.admission_year);
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
  const text = await response.text();
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as T);
}

let knowledgePromise: Promise<FaqKnowledge> | undefined;
export function loadFaqKnowledge(): Promise<FaqKnowledge> {
  if (knowledgePromise) return knowledgePromise;
  const base = `${import.meta.env.BASE_URL}data/`;
  knowledgePromise = Promise.all([
    readJsonl<FaqRecord>(`${base}faq_dataset.jsonl`),
    readJsonl<ConversationIntent>(`${base}chatbot_intents.jsonl`),
    fetch(`${base}chatbot_config.json`).then(response => { if (!response.ok) throw new Error(`Could not load chatbot configuration (${response.status}).`); return response.json() as Promise<Record<string, unknown>>; }),
  ]).then(([faqs, intents, config]) => {
    const verified = faqs.filter(validFaq);
    if (verified.length === 0) throw new Error('The verified FAQ dataset is empty.');
    return { faqs: verified, intents, config };
  }).catch(error => { knowledgePromise = undefined; throw error; });
  return knowledgePromise;
}

export function matchConversationIntent(input: string, intents: ConversationIntent[]): ConversationIntent | undefined {
  const normalized = normalizeFaqText(input);
  if (!normalized) return undefined;
  return intents.find(intent => intent.trigger_phrases.some(phrase => {
    const trigger = normalizeFaqText(phrase);
    if (normalized === trigger) return true;
    if (['greeting', 'farewell', 'thanks'].includes(intent.intent)) return normalized.split(' ').length <= trigger.split(' ').length + 2 && normalized.startsWith(`${trigger} `);
    return normalized.startsWith(`${trigger} `) || normalized.includes(` ${trigger}`);
  }));
}

export function matchFaq(input: string, faqs: FaqRecord[], context?: { admissionYear?: string; category?: string }): FaqMatch | undefined {
  const query = normalizeFaqText(input);
  if (!query) return undefined;
  let best: FaqMatch | undefined;
  for (const record of faqs) {
    const candidates = [record.question, record.canonical_question ?? '', ...(record.alternative_questions ?? [])].filter(Boolean);
    const exact = candidates.some(candidate => normalizeFaqText(candidate) === query);
    const contextBoost = context?.admissionYear && record.admission_year === context.admissionYear ? 0.04 : 0;
    const categoryBoost = context?.category && record.category.toLowerCase().includes(context.category.toLowerCase()) ? 0.03 : 0;
    const score = (exact ? 1 : Math.max(...candidates.map(candidate => similarity(input, candidate)), 0)) + contextBoost + categoryBoost;
    const matchedBy = exact ? (normalizeFaqText(record.question) === query ? 'exact' : 'alias') : 'keywords';
    if (!best || score > best.score) best = { record, score, matchedBy };
  }
  if (!best) return undefined;
  const threshold = best.matchedBy === 'exact' || best.matchedBy === 'alias' ? 0.99 : 0.72;
  return best.score >= threshold ? best : undefined;
}

export function clearFaqKnowledgeCache() { knowledgePromise = undefined; }
