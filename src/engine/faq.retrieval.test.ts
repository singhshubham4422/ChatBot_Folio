import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isFaqContextSelection, matchFaq, parseFaqContextSelection, retrieveFaq, type FaqRecord } from './faq';

const repo = process.cwd();
const canonicalFaqPath = existsSync(resolve(repo, 'SmartBot/data/faq_dataset.jsonl'))
  ? resolve(repo, 'SmartBot/data/faq_dataset.jsonl')
  : resolve(repo, 'public/data/faq_dataset.jsonl');
const faqs = readFileSync(canonicalFaqPath, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line) as FaqRecord);

function rewriteQuery(question: string, index: number): string {
  let value = question.replace(/[?]+$/, '');
  const heads: Array<[RegExp, string]> = [
    [/^What are\s+/i, 'Could you explain '],
    [/^What is\s+/i, 'Tell me about '],
    [/^When\s+/i, 'Could you tell me when '],
    [/^Which\s+/i, 'Can you identify which '],
    [/^How much\s+/i, 'What is the cost of '],
    [/^Can\s+/i, 'Is it possible to '],
    [/^Does\s+/i, 'Please explain whether '],
    [/^Who\s+/i, 'Which applicants '],
  ];
  const [pattern, replacement] = heads[index % heads.length];
  value = value.replace(pattern, replacement);
  if (index % 4 === 0) value = value.replace(/\bfees?\b/gi, match => match.toLowerCase() === 'fee' ? 'cost' : 'charges');
  if (index % 4 === 1) value = value.replace(/\beligibility\b/gi, 'qualification');
  if (index % 4 === 2) value = value.replace(/\bdates?\b/gi, 'deadline');
  return `${value}?`;
}

const families = [
  { id: 'BITSAT-2026-', family: 'bitsat' as const, year: '2026-27' },
  { id: 'FD-Admission-Modality-', family: 'first-degree' as const, year: '2022-23' },
  { id: 'BITS-HD-2025-26-', family: 'higher-degree' as const, year: '2025-26' },
  { id: 'Cross-document-', family: undefined, year: 'Multiple cycles' },
];

const retrievalCases = families.flatMap(({ id, family, year }) => {
  const records = faqs.filter(record => record.id.startsWith(id) && record.id.endsWith('-1'));
  return Array.from({ length: 20 }, (_unused, index) => {
    const record = records[Math.floor(index * records.length / 20)];
    const query = rewriteQuery(record.question, index);
    const expectedIds = faqs.filter(candidate => candidate.answer === record.answer && candidate.admission_year === record.admission_year).map(candidate => candidate.id);
    return { query, record, expectedIds, context: family ? { family, admissionYear: year } : {} };
  });
});

const ambiguousCases = [
  'What are the eligibility requirements?', 'What are the admission fees?', 'What are the important dates?',
  'How do I qualify?', 'What costs should I expect?', 'When are the deadlines?',
  'Tell me the eligibility criteria', 'What charges apply?', 'Give me the admission timeline', 'What are the requirements?',
];
const unknownCases = ['What is the weather in Mumbai?', 'Who won the cricket match?', 'How do I bake sourdough?', 'What is the capital of France?', 'Tell me a joke.', 'What is my application password?', 'How do I install a graphics card?', 'What is the price of a phone?', 'Can you book a taxi?', 'What is the meaning of quantum gravity?'];

describe('dataset retrieval regression set (100 queries)', () => {
  it('measures top-1 accuracy on 80 held-out phrasings of source FAQ questions', () => {
    const outcomes = retrievalCases.map(testCase => {
      const actual = retrieveFaq(testCase.query, faqs, testCase.context);
      if (!actual.match || !testCase.expectedIds.includes(actual.match.record.id)) console.info('[faq-retrieval-miss]', { query: testCase.query, expected: testCase.expectedIds[0], actual: actual.match?.record.id, clarification: actual.needsClarification, reason: actual.reason, top: actual.candidates.slice(0, 3).map(candidate => [candidate.record.id, candidate.score]) });
      return actual.match && testCase.expectedIds.includes(actual.match.record.id);
    });
    const accuracy = outcomes.filter(Boolean).length / outcomes.length;
    console.info(`[faq-retrieval-eval] top1=${(accuracy * 100).toFixed(1)}% (${outcomes.filter(Boolean).length}/${outcomes.length})`);
    expect(accuracy).toBeGreaterThanOrEqual(0.8);
  });

  it('clarifies 10 broad multi-programme questions instead of choosing a route silently', () => {
    const falseMatches = ambiguousCases.filter(query => { const retrieval = retrieveFaq(query, faqs); if (!retrieval.needsClarification) console.info('[faq-ambiguity-miss]', query, retrieval.match?.record.id, retrieval.reason); return !retrieval.needsClarification; }).length;
    const rate = falseMatches / ambiguousCases.length;
    console.info(`[faq-retrieval-eval] ambiguous_false_match=${(rate * 100).toFixed(1)}% (${falseMatches}/${ambiguousCases.length})`);
    expect(rate).toBe(0);
  });

  it('rejects 10 unrelated questions instead of returning the top lexical overlap', () => {
    const falseMatches = unknownCases.filter(query => { const retrieval = retrieveFaq(query, faqs); if (retrieval.match) console.info('[faq-false-match]', query, retrieval.match.record.id, retrieval.match.score); return Boolean(retrieval.match); }).length;
    const rate = falseMatches / unknownCases.length;
    console.info(`[faq-retrieval-eval] unknown_false_match=${(rate * 100).toFixed(1)}% (${falseMatches}/${unknownCases.length})`);
    expect(rate).toBe(0);
  });

  it('has at least 100 stable query cases and validates all referenced source PDFs exist', () => {
    expect(retrievalCases.length + ambiguousCases.length + unknownCases.length).toBe(100);
    const pdfs = new Set(readdirSync(resolve(repo, 'public/pdfs')).map(file => file.toLowerCase()));
    const missing = faqs.flatMap(record => (record.source_references ?? []).filter(source => !pdfs.has(source.file.replace(/ \(1\)(?=\.pdf$)/i, '').toLowerCase())).map(source => `${record.id}: ${source.file}`));
    expect(missing).toEqual([]);
  });
});

describe('reported query failures', () => {
  it('recognizes years, programme aliases, categories, and explicit context chips', () => {
    expect(parseFaqContextSelection('Specify BITSAT-2026')).toMatchObject({ family: 'bitsat', admissionYear: '2026-27' });
    expect(parseFaqContextSelection('Specify Higher-Degree 2025-26')).toMatchObject({ family: 'higher-degree', admissionYear: '2025-26' });
    expect(isFaqContextSelection('Specify Higher-Degree 2025-26')).toBe(true);
    expect(parseFaqContextSelection('M.E. fees')).toMatchObject({ family: 'higher-degree', category: 'fees' });
  });

  it('clarifies broad eligibility, finds Higher Degree fees, and handles aliases', () => {
    expect(retrieveFaq('What are the eligibility requirements?', faqs).needsClarification).toBe(true);
    expect(retrieveFaq('Higher Degree fees', faqs).candidates[0]?.record.admission_year).toBe('2025-26');
    expect(matchFaq('What is the Higher Degree application cost?', faqs)?.record.id).toMatch(/^BITS-HD-2025-26/);
    expect(matchFaq('Who is qualified for M.E. Computer Science?', faqs)?.record.id).toMatch(/^BITS-HD-2025-26/);
  });
});
