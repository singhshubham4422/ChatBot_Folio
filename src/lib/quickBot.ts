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
