import type { Chunk } from '../types';
import { rankChunks } from './document';

export type QuickBotDocument = { fileName: string; pageCount: number };
export type QuickBotIndex = { version: number; generatedAt: string; documents: QuickBotDocument[]; chunks: Chunk[] };

let cachedIndex: QuickBotIndex | undefined;
let loading: Promise<QuickBotIndex> | undefined;

export async function loadQuickBotIndex(): Promise<QuickBotIndex> {
  if (cachedIndex) return cachedIndex;
  if (!loading) {
    loading = fetch('/quick-bot/index.json', { cache: 'force-cache' })
      .then(async response => {
        if (!response.ok) throw new Error('The quick bot index is not available in this deployment.');
        const value = await response.json() as QuickBotIndex;
        if (!Array.isArray(value.documents) || !Array.isArray(value.chunks)) throw new Error('The quick bot index is invalid.');
        const allowedFiles = new Set(value.documents.map(document => document.fileName));
        value.chunks = value.chunks.filter(chunk => allowedFiles.has(chunk.fileName ?? ''));
        cachedIndex = value;
        return value;
      })
      .finally(() => { loading = undefined; });
  }
  return loading;
}

export function searchQuickBot(index: QuickBotIndex, query: string, limit = 5): Chunk[] {
  return rankChunks(query, index.chunks, limit).map(chunk => ({ ...chunk, documentId: `quick:${chunk.fileName}` }));
}

const COMMON_WORDS = new Set('a an and are as at be by can does for from how i in is it of on or that the this to was what when where which who why with'.split(' '));

export function extractiveQuickAnswer(question: string, index: QuickBotIndex): { answer: string; evidence: Chunk[] } {
  const selected = searchQuickBot(index, question, 5);
  const terms = (question.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter(term => !COMMON_WORDS.has(term));
  const candidates = selected.flatMap(chunk => {
    const sentences = chunk.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [chunk.text];
    return sentences.map(sentence => {
      const normalized = sentence.replace(/\s+/g, ' ').trim();
      const words: string[] = normalized.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
      const overlap = terms.reduce((score, term) => score + (words.includes(term) ? 1 : 0), 0);
      return { sentence: normalized, chunk, score: overlap + (normalized.length >= 35 && normalized.length <= 280 ? 0.25 : 0) };
    }).filter(item => item.sentence.length >= 25 && item.score > 0);
  }).sort((a, b) => b.score - a.score);
  const chosen: typeof candidates = [];
  for (const candidate of candidates) {
    if (chosen.some(item => item.sentence.toLowerCase() === candidate.sentence.toLowerCase())) continue;
    chosen.push(candidate);
    if (chosen.length === 3) break;
  }
  const evidence = [...new Map(chosen.map(item => [item.chunk.id, item.chunk])).values()];
  const answer = chosen.length
    ? chosen.map(item => item.sentence).join(' ')
    : (selected[0] ? selected[0].text.slice(0, 700).trim() : 'I could not find supporting text in the prepared documents.');
  return { answer, evidence };
}

export function deterministicQuickAnswer(question: string, index: QuickBotIndex): { answer: string; evidence: Chunk[] } | undefined {
  if (!/\b(?:full\s+form|stand\s+for|meaning)\b/i.test(question) || !/\bBITSAT\b/i.test(question)) return undefined;
  const matches = index.chunks.filter(chunk => /BITS\s*Admission\s*Test/i.test(chunk.text));
  const match = matches.find(chunk => /BITSAT/i.test(chunk.fileName ?? '')) ?? matches[0];
  if (!match) return undefined;
  return {
    answer: 'BITSAT stands for BITS Admission Test.',
    evidence: [{ ...match, documentId: `quick:${match.fileName}` }],
  };
}
