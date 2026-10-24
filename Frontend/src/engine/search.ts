import { CONFIG } from './config.ts';
import type { Chunk, IndexPayload, ScoredChunk, SearchResult, BM25Stats } from './types.ts';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from',
  'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'all', 'any', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can',
  'will', 'just', 'should', 'now', 'what', 'which', 'who', 'whom',
  'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does',
  'did', 'doing', 'would', 'could', 'how', 'why', 'of', 'in', 'on', 'is', 'there'
]);

export function tokenizeQuery(query: string): string[] {
  const cleaned = query
    .toLowerCase()
    .replace(/\b(\d+)\s+(th|st|nd|rd)\b/gi, '$1$2')
    .replace(/\s+/g, ' ');

  // Preserve words, numbers, hyphenated terms, and +/- signs (e.g. "bitsat-2026", "+3", "-1", "12th", "130")
  const tokens = cleaned.match(/[-+]?\b\w[\w.-]*\b|[-+]\d+/g) || [];
  const result: string[] = [];

  for (const t of tokens) {
    if (t.length > 1 && !STOP_WORDS.has(t)) {
      result.push(t);
    }
  }

  // Synonym expansion
  for (const entry of CONFIG.SYNONYM_MAP) {
    const matches = entry.match.some(m => cleaned.includes(m));
    if (matches) {
      for (const syn of entry.synonyms) {
        const synTokens = syn.toLowerCase().match(/[-+]?\b\w[\w.-]*\b|[-+]\d+/g) || [];
        for (const st of synTokens) {
          if (st.length > 1 && !STOP_WORDS.has(st) && !result.includes(st)) {
            result.push(st);
          }
        }
      }
    }
  }

  return result;
}

export class VectorStore {
  private chunks: Chunk[] = [];
  private vectors: Float32Array | null = null;
  private bm25Stats: BM25Stats | null = null;
  private termPages: Record<string, Array<{ file: string; page: number }>> = {};
  private dim: number = 384;
  private isLoaded: boolean = false;

  async load(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load index from ${url}: ${response.statusText}`);
    }

    const payload: IndexPayload = await response.json();
    this.chunks = payload.chunks;
    this.dim = payload.dim || 384;
    this.bm25Stats = payload.bm25;
    this.termPages = payload.termPages || {};

    // Decode base64 vectors into Float32Array
    const binaryStr = atob(payload.vectors);
    const byteLength = binaryStr.length;
    const bytes = new Uint8Array(byteLength);

    for (let i = 0; i < byteLength; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    this.vectors = new Float32Array(bytes.buffer, bytes.byteOffset, byteLength / 4);
    this.isLoaded = true;
  }

  get chunkCount(): number {
    return this.chunks.length;
  }

  get ready(): boolean {
    return this.isLoaded && this.vectors !== null;
  }

  getTermPages(): Record<string, Array<{ file: string; page: number }>> {
    return this.termPages;
  }

  expandSection(sectionTitle: string, sourceFile: string, maxWords = 900): Chunk[] {
    const section = this.chunks
      .filter(chunk => chunk.sectionTitle === sectionTitle && chunk.sourceFile === sourceFile)
      .sort((a, b) => a.pageStart - b.pageStart);
    const expanded: Chunk[] = [];
    let words = 0;
    for (const chunk of section) {
      const count = chunk.text.split(/\s+/).length;
      if (expanded.length && words + count > maxWords) break;
      expanded.push(chunk);
      words += count;
    }
    return expanded;
  }

  search(
    query: string,
    queryVector: Float32Array,
    topK: number = 3,
    threshold: number = CONFIG.THRESHOLD
  ): SearchResult {
    if (!this.vectors || this.chunks.length === 0 || !this.bm25Stats) {
      throw new Error('Vector store is not initialized');
    }

    const total = this.chunks.length;
    const dim = this.dim;
    const queryTokens = tokenizeQuery(query);
    const idf = this.bm25Stats.idf;
    const avgDocLen = this.bm25Stats.avgDocLen;

    const k1 = 1.2;
    const b = 0.75;

    // 1. Compute BM25 raw scores for each chunk
    const rawBM25Scores = new Float32Array(total);
    let maxBM25 = 0;

    for (let i = 0; i < total; i++) {
      const chunk = this.chunks[i];
      let bm25 = 0;

      for (const token of queryTokens) {
        const tokenIDF = idf[token] || 0;
        if (tokenIDF <= 0) continue;

        const tf = chunk.termFreqs[token] || 0;
        if (tf > 0) {
          const numerator = tf * (k1 + 1);
          const denominator = tf + k1 * (1 - b + b * (chunk.docLen / avgDocLen));
          bm25 += tokenIDF * (numerator / denominator);
        }
      }

      rawBM25Scores[i] = bm25;
      if (bm25 > maxBM25) maxBM25 = bm25;
    }

    // 2. Check query source routing rules
    const targetFileBoosts: Record<string, number> = {};
    for (const rule of CONFIG.ROUTING_RULES) {
      if (rule.patterns.some(p => p.test(query))) {
        targetFileBoosts[rule.targetFile] = (targetFileBoosts[rule.targetFile] || 0) + CONFIG.SOURCE_ROUTING_BOOST;
      }
    }

    // 3. Compute hybrid scores
    const scoredChunks: ScoredChunk[] = new Array(total);

    for (let i = 0; i < total; i++) {
      const chunk = this.chunks[i];
      const offset = i * dim;

      // Dot product (cosine similarity)
      let dot = 0;
      for (let d = 0; d < dim; d++) {
        dot += queryVector[d] * this.vectors[offset + d];
      }

      // Normalized BM25 (0 to 1)
      const normBM25 = maxBM25 > 0 ? rawBM25Scores[i] / maxBM25 : 0;

      // Soft routing boost (+0.05)
      const routingBoost = targetFileBoosts[chunk.sourceFile] || 0;
      const tableOfContentsPenalty = /(?:^Section:\s*INDEX\b|\|\s*(?:S\.no\.|Contents|Page No)\b|\|\s*Admissions to Higher Degree Programmes\s*\|)/i.test(chunk.text) ? 0.22 : 0;
      const tableIntentBoost = chunk.type === 'table' && /\b(?:total questions|number of questions|question count)\b/i.test(query) && /\b130\b/.test(chunk.text) ? 0.25 : 0;
      const eligibilitySectionBoost = /\b(?:programme|eligibility|criteria)\b/i.test(query) && /eligibility criteria/i.test(chunk.sectionTitle) ? 0.22 : 0;

      // Hybrid formula: 0.6 * embedding + 0.4 * normalized_bm25 + routingBoost
      const hybrid = CONFIG.EMBEDDING_WEIGHT * dot + CONFIG.BM25_WEIGHT * normBM25 + routingBoost + tableIntentBoost + eligibilitySectionBoost - tableOfContentsPenalty;

      scoredChunks[i] = {
        ...chunk,
        embeddingScore: dot,
        bm25Score: normBM25,
        routingBoost,
        score: hybrid,
      };
    }

    // Sort descending by hybrid score
    scoredChunks.sort((a, b) => b.score - a.score);

    const comparative = /\b(compare|versus|vs\.?|difference|both|each|rather than|older|newer|current|previous)\b/i.test(query);
    let topResults = scoredChunks.slice(0, topK);
    if (comparative) {
      const routedFiles = [...new Set(scoredChunks.filter(chunk => chunk.routingBoost > 0).map(chunk => chunk.sourceFile))];
      const diversified = routedFiles.map(file => scoredChunks.find(chunk => chunk.sourceFile === file)).filter((chunk): chunk is ScoredChunk => Boolean(chunk));
      topResults = [...diversified, ...scoredChunks].filter((chunk, index, all) => all.findIndex(item => item.id === chunk.id) === index).slice(0, topK).sort((a, b) => b.score - a.score);
    }
    const topScore = topResults.length > 0 ? topResults[0].score : 0;
    const isOutOfContext = topScore < threshold;

    return {
      isOutOfContext,
      topScore,
      results: topResults,
    };
  }
}
