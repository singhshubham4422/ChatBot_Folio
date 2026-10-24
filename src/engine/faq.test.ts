import { describe, expect, it } from 'vitest';
import { matchConversationIntent, matchFaq, normalizeFaqText, type ConversationIntent, type FaqRecord } from './faq';

const faq = (question: string, answer: string, overrides: Partial<FaqRecord> = {}): FaqRecord => ({
  id: overrides.id ?? 'FAQ-1', question, answer, category: overrides.category ?? 'eligibility', keywords: overrides.keywords ?? 'eligibility',
  source_files: overrides.source_files ?? ['BITSAT-2026_brochure.pdf'], source_pages: overrides.source_pages ?? ['4'], admission_year: overrides.admission_year ?? '2026-27', intent_type: 'factual_faq',
  canonical_question: overrides.canonical_question ?? question, alternative_questions: overrides.alternative_questions ?? [], follow_up_suggestions: ['What programmes are available?'],
  source_references: [{ file: 'BITSAT-2026_brochure.pdf', pages: '4', admission_year: overrides.admission_year ?? '2026-27' }],
});

const intents: ConversationIntent[] = [
  { id: 'greeting', intent_type: 'conversational', intent: 'greeting', trigger_phrases: ['hi', 'hello'], answer: 'Hello!', category: 'conversation', keywords: ['greeting'], follow_up_suggestions: ['Show categories'], context_action: 'reset_pending_topic_keep_admission_year', source_files: [], source_pages: [], admission_year: 'not_applicable' },
  { id: 'farewell', intent_type: 'conversational', intent: 'farewell', trigger_phrases: ['bye'], answer: 'Goodbye!', category: 'conversation', keywords: ['farewell'], follow_up_suggestions: [], context_action: 'clear_active_topic', source_files: [], source_pages: [], admission_year: 'not_applicable' },
];

describe('FAQ matcher', () => {
  it('normalizes BITSAT spelling, punctuation, and common abbreviations', () => {
    expect(normalizeFaqText('What is bit-sat 2026?')).toBe('what is bitsat 2026');
    expect(normalizeFaqText('M. E. eligibility')).toBe('me eligibility');
  });

  it('matches exact canonical questions and aliases', () => {
    const record = faq('What is BITSAT-2026 used for?', 'It is the admission test.', { alternative_questions: ['What admissions does BITSAT cover?'] });
    expect(matchFaq(record.question, [record])?.matchedBy).toBe('exact');
    expect(matchFaq('What admissions does BITSAT cover?', [record])?.matchedBy).toBe('alias');
  });

  it('uses strong keyword matching but rejects weak matches', () => {
    const record = faq('What marks are required for admission eligibility?', '75% aggregate and 60% in each subject.');
    expect(matchFaq('admission eligibility marks', [record])?.record.id).toBe(record.id);
    expect(matchFaq('tell me something unrelated', [record])).toBeUndefined();
  });

  it('preserves admission-year context when two records are similar', () => {
    const oldRecord = faq('What are the admission fees?', 'Historical fee.', { id: 'old', admission_year: '2022-23', category: 'fees' });
    const newRecord = faq('What are the admission fees?', 'Current-cycle fee.', { id: 'new', admission_year: '2026-27', category: 'fees' });
    expect(matchFaq('What are the admission fees?', [oldRecord, newRecord], { admissionYear: '2026-27' })?.record.id).toBe('new');
  });
});

describe('conversation intent routing', () => {
  it('routes short greetings and farewells separately from factual FAQs', () => {
    expect(matchConversationIntent('Hi', intents)?.intent).toBe('greeting');
    expect(matchConversationIntent('bye', intents)?.intent).toBe('farewell');
    expect(matchConversationIntent('Hi, what is the BITSAT eligibility?', intents)).toBeUndefined();
  });
});
