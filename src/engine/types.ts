export interface SentenceItem {
  text: string;
  page: number;
}

export interface Chunk {
  id: string;
  heading: string;
  text: string;
  sourceFile: string;
  pageStart: number;
  pageEnd: number;
  sentences: SentenceItem[];
  termFreqs: Record<string, number>;
  docLen: number;
}

export interface BM25Stats {
  avgDocLen: number;
  totalDocs: number;
  idf: Record<string, number>;
}

export interface IndexPayload {
  model: string;
  dim: number;
  bm25: BM25Stats;
  termPages: Record<string, Array<{ file: string; page: number }>>;
  chunks: Chunk[];
  vectors: string; // base64 Float32Array
}

export interface ScoredChunk extends Chunk {
  embeddingScore: number;
  bm25Score: number;
  routingBoost: number;
  score: number;
}

export interface SearchResult {
  isOutOfContext: boolean;
  topScore: number;
  results: ScoredChunk[];
}
