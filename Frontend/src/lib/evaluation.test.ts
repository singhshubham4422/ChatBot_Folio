import { describe, expect, it } from 'vitest';
import { rankChunks } from './document';
import { evaluationDocument, evaluationQuestions } from './evaluation.fixture';

describe('fixed retrieval evaluation set (30 questions)', () => {
  it('returns expected supporting pages in the top four for every answerable question', () => {
    const answerable = evaluationQuestions.filter(item => item.pages.length > 0);
    const results = answerable.map(item => ({ item, pages: new Set(rankChunks(item.query, [...evaluationDocument], 4).map(chunk => chunk.page)) }));
    const hits = results.filter(({ item, pages }) => item.pages.some(page => pages.has(page))).length;
    console.info(`Retrieval supporting-page hit@4: ${hits}/${results.length} (${Math.round(hits / results.length * 100)}%) on the fixed synthetic set.`);
    expect({ hits, total: results.length, recallAt4: hits / results.length }).toMatchObject({ hits: results.length, total: results.length });
  });
  it('does not retrieve any passage for the absent answer cases', () => {
    const absent = evaluationQuestions.filter(item => item.kind === 'absent');
    for (const item of absent) expect(rankChunks(item.query, [...evaluationDocument], 4), item.id).toEqual([]);
  });
});
