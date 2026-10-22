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
