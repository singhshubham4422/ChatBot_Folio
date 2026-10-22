import { describe, expect, it } from 'vitest';
import { chunkPage, deterministicAnswer, rankChunks, selectChunksForQuestion } from './document';
import type { Chunk } from '../types';

const make = (id: string, page: number, text: string): Chunk => ({ id, page, text, start: 0, end: text.length, quality: 'good' });

describe('local lexical retrieval', () => {
  const chunks = [
    make('finance', 1, 'Revenue increased to 18 million dollars after the subscription renewal rate improved.'),
    make('climate', 2, 'The research team measured rainfall and average temperatures across the study area.'),
    make('retention', 6, 'Customer retention reached 92 percent in the final quarter.'),
  ];
  it('ranks direct lexical matches above unrelated passages', () => {
    expect(rankChunks('What was the subscription renewal revenue?', chunks, 2).map(c => c.id)).toEqual(['finance']);
  });
  it('returns supporting passages for cross-page synthesis queries', () => {
    expect(rankChunks('Compare customer retention and rainfall', chunks, 3).map(c => c.page)).toContain(6);
    expect(rankChunks('Compare customer retention and rainfall', chunks, 3).map(c => c.page)).toContain(2);
  });
  it('abstains when no query terms match', () => {
    expect(rankChunks('volcanic geology', chunks)).toEqual([]);
  });
  it('selects document-wide evidence for natural-language summaries', () => {
    expect(selectChunksForQuestion('Summarize this PDF', chunks).map(chunk => chunk.page)).toEqual([1, 2, 6]);
  });
  it('answers page-count metadata deterministically', () => {
    expect(deterministicAnswer('How many pages does this document have?', { pageCount: 12 })).toBe('This document has 12 pages.');
    expect(deterministicAnswer('What is the file name?', { fileName: 'annual-report.pdf' })).toContain('annual-report.pdf');
  });
  it('does not answer deterministic metadata questions without stored facts', () => {
    expect(deterministicAnswer('How many pages?', {})).toBeUndefined();
  });
  it('chunks long page text with offsets, page references, and bounded overlap', () => {
    const text = `FINANCIAL SUMMARY\n${Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ')}`;
    const page = chunkPage({ page: 7, text, quality: 'good' });
    expect(page.length).toBeGreaterThan(1);
    expect(page[0].section).toBe('FINANCIAL SUMMARY');
    expect(page.every(chunk => chunk.page === 7 && chunk.text === text.slice(chunk.start, chunk.end).trim())).toBe(true);
    expect(page[0].text.split(/\s+/).length).toBeLessThanOrEqual(452);
    expect(page[1].text.split(/\s+/)[0]).toBe('word380');
  });
});
