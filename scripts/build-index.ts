import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pipeline } from '@huggingface/transformers';
import { normalizeTableRows } from '../src/engine/tables.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SentenceItem {
  text: string;
  page: number;
}

interface TableData {
  heading: string;
  columns: string[];
  rows: string[][];
  page: number;
}

type ChunkType = 'text' | 'table' | 'list';

interface Chunk {
  id: string;
  heading: string;
  sectionTitle: string;
  text: string;
  sourceFile: string;
  pageStart: number;
  pageEnd: number;
  sentences: SentenceItem[];
  type: ChunkType;
  tables: TableData[];
  neighboringIds: { prev?: string; next?: string };
  qualifiers: string[];
  termFreqs: Record<string, number>;
  docLen: number;
}

interface BM25Stats {
  avgDocLen: number;
  totalDocs: number;
  idf: Record<string, number>;
}

interface IndexData {
  model: string;
  dim: number;
  bm25: BM25Stats;
  termPages: Record<string, Array<{ file: string; page: number }>>;
  chunks: Chunk[];
  vectors: string; // base64 encoded Float32Array
}

const CHUNK_SIZE = 120;
const CHUNK_OVERLAP = 20;
const BATCH_SIZE = 16;
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

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
  'did', 'doing', 'would', 'could', 'how', 'why', 'of'
]);

export function cleanExtractedText(raw: string): string {
  return raw
    .replace(/(\b[A-Za-z]+)-\s*\n\s*([A-Za-z]+\b)/g, '$1$2')
    .replace(/\b(\d+)\s+(th|st|nd|rd)\b/gi, '$1$2')
    .replace(/\s+([,.:;?!])/g, '$1')
    .replace(/[\r\t\f\v]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeBM25(text: string): string[] {
  const cleaned = cleanExtractedText(text).toLowerCase();
  const tokens = cleaned.match(/[-+]?\b\w[\w.-]*\b|[-+]\d+/g) || [];
  return tokens.filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

function isHeadingCandidate(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 4 || trimmed.length > 70) return false;
  if (trimmed.endsWith(':')) return true;
  if (/^Part\s+[I|V|X]+/i.test(trimmed)) return true;
  if (/^\d+(\.\d+)*\s+[A-Z]/i.test(trimmed)) return true;
  if (/^(BITSAT[- ]\d+|Pattern of|Format of|Eligibility|Admission Modality|Financial Assistance|Scholarships|Test Center|Merit List|Syllabus|Fees required)/i.test(trimmed)) return true;
  if (trimmed === trimmed.toUpperCase() && trimmed.length < 40 && /[A-Z]/.test(trimmed)) return true;
  return false;
}

/**
 * Reconstruct table rows on fee-heavy pages using coordinate grouping (group by y, sort by x)
 */
function reconstructTable(items: any[], page: number, heading: string): TableData | undefined {
  const rows: Map<number, any[]> = new Map();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    let matchedY: number | null = null;
    for (const rowY of rows.keys()) {
      if (Math.abs(rowY - y) <= 4) {
        matchedY = rowY;
        break;
      }
    }
    if (matchedY !== null) {
      rows.get(matchedY)!.push(it);
    } else {
      rows.set(y, [it]);
    }
  }

  const sortedY = Array.from(rows.keys()).sort((a, b) => b - a);
  const matrix = sortedY.map(y => {
    const items = rows.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]);
    const cells: string[] = [];
    let previousEnd = -Infinity;
    for (const item of items) {
      const text = cleanExtractedText(item.str);
      if (!text) continue;
      const x = Number(item.transform[4]);
      const gap = x - previousEnd;
      if (!cells.length || gap > 8) cells.push(text);
      else if (gap <= 2) cells[cells.length - 1] = cleanExtractedText(`${cells[cells.length - 1]}${text}`);
      else cells[cells.length - 1] = cleanExtractedText(`${cells[cells.length - 1]} ${text}`);
      previousEnd = x + Number(item.width || text.length * 4);
    }
    return cells;
  });
  const useful = matrix.filter(row => row.length >= 2 && row.some(cell => /\d|%|USD|INR|Rs\.?|March|April|May|June|July|August|September|October|November|December/i.test(cell)));
  if (useful.length < 2) return undefined;

  const headerCandidate = matrix.find(row => row.length >= 2 && row.every(cell => !/[\d₹$]/.test(cell)));
  const columns = headerCandidate && headerCandidate.length <= 3 ? headerCandidate : ['Item', 'Amount / details'];
  const rowsData = useful.map(row => {
    if (columns.length <= 2) return normalizeTableRows([row])[0] ?? [];
    const normalized = [...row];
    while (normalized.length < columns.length) normalized.push('');
    return normalized.slice(0, columns.length);
  }).filter(row => row.some(Boolean));
  const amountRows = rowsData.filter(row => row[0] && row.slice(1).some(cell => /\d|%|USD|INR|Rs\.?|January|February|March|April|May|June|July|August|September|October|November|December/i.test(cell)));
  if (amountRows.length < 2) return undefined;
  return { heading, columns, rows: amountRows, page };
}

function tableLines(table: TableData): string[] {
  return table.rows
    .filter(row => row[0] && row.slice(1).some(Boolean))
    .map(row => row.join(' | '));
}

function findQualifiers(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.match(/\b(?:20\d\d[-–]\d\d|AY\s*20\d\d[-–]\d\d|ISA|First Degree|Higher Degree|M\.E\.|M\.Pharm|Dubai|Pilani|Hyderabad|Goa|International Student Admission)\b/gi) ?? []) found.add(cleanExtractedText(match));
  return [...found];
}

async function extractPagesFromPdf(
  filePath: string,
  fontUrl: string,
  fileName: string
): Promise<{ pages: Array<{ pageNum: number; sentences: SentenceItem[]; heading: string; type: ChunkType; tables: TableData[]; qualifiers: string[] }>; pageCount: number; emptyPages: number[] }> {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: fontUrl,
  }).promise;

  const pages: Array<{ pageNum: number; sentences: SentenceItem[]; heading: string; type: ChunkType; tables: TableData[]; qualifiers: string[] }> = [];
  const emptyPages: number[] = [];

  let currentHeading = 'Overview';

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const rawStrings: string[] = [];

    for (const item of content.items) {
      if ('str' in item && typeof item.str === 'string') {
        const str = item.str;
        rawStrings.push(str);
        if (isHeadingCandidate(str)) {
          currentHeading = cleanExtractedText(str).replace(/:$/, '');
        }
      }
    }

    const fullPageText = cleanExtractedText(rawStrings.join(' '));

    if (!fullPageText) {
      emptyPages.push(pageNum);
      continue;
    }

    const pageSentences: SentenceItem[] = [];
    const pageTables = [reconstructTable(content.items as any[], pageNum, currentHeading)].filter((table): table is TableData => Boolean(table));

    // On fee-table pages in Admission Modality (pages 28-31), use coordinate-based row reconstruction
    if (pageTables.length > 0) {
      const tableRows = pageTables.flatMap(tableLines);
      for (const line of tableRows) {
        let cleaned = cleanExtractedText(line).replace(/^[-*•\d.)\s]+/, '').trim();
        if (!cleaned || cleaned.startsWith('III-')) continue;
        if (!/[.!?]$/.test(cleaned)) cleaned += '.';
        pageSentences.push({ text: cleaned, page: pageNum });
      }
    } else {
      // Standard sentence extraction
      const rawSentences = fullPageText.split(/(?<=[.!?])\s+|[•\n\r]+/g);
      for (const raw of rawSentences) {
        let cleaned = cleanExtractedText(raw).replace(/^[-*•\d.)\s]+/, '').trim();
        if (!cleaned) continue;

        // Fix cut-off: if sentence starts with lowercase or mid-sentence conjunction, merge backward
        if (
          pageSentences.length > 0 &&
          (/^[a-z]/.test(cleaned) || /^(and|or|but|while|further|which|whereas|including|with|having)\b/i.test(cleaned))
        ) {
          const last = pageSentences[pageSentences.length - 1];
          last.text = `${last.text.replace(/[.!?]+$/, '')} ${cleaned}`;
          continue;
        }

        if (!/[.!?]$/.test(cleaned) && cleaned.length > 20) {
          cleaned += '.';
        }

        pageSentences.push({
          text: cleaned,
          page: pageNum,
        });
      }
    }

    const pageType: ChunkType = pageTables.length ? 'table' : pageSentences.some(sentence => /^[-*•]/.test(sentence.text)) ? 'list' : 'text';
    pages.push({
      pageNum,
      sentences: pageSentences,
      heading: currentHeading,
      type: pageType,
      tables: pageTables,
      qualifiers: findQualifiers(fullPageText),
    });
  }

  return { pages, pageCount: doc.numPages, emptyPages };
}

function chunkDocumentPages(
  pages: Array<{ pageNum: number; sentences: SentenceItem[]; heading: string; type: ChunkType; tables: TableData[]; qualifiers: string[] }>,
  sourceFile: string,
  startChunkId: number
): Chunk[] {
  const chunks: Chunk[] = [];
  let chunkCount = startChunkId;

  const allDocSentences: Array<{ text: string; page: number; heading: string; type: ChunkType; tables: TableData[]; qualifiers: string[] }> = [];
  for (const p of pages) {
    for (const s of p.sentences) {
      allDocSentences.push({
        text: s.text,
        page: s.page,
        heading: p.heading,
        type: p.type,
        tables: p.tables,
        qualifiers: p.qualifiers,
      });
    }
  }

  if (allDocSentences.length === 0) return chunks;

  const sectionGroups: Array<typeof allDocSentences> = [];
  for (const sentence of allDocSentences) {
    const group = sectionGroups[sectionGroups.length - 1];
    if (!group || group[0].heading !== sentence.heading) sectionGroups.push([sentence]);
    else group.push(sentence);
  }
  if (sectionGroups.length > 1) {
    const merged: Chunk[] = [];
    let nextId = startChunkId;
    for (const group of sectionGroups) {
      const pseudoPages = group.map(item => ({
        pageNum: item.page,
        sentences: [{ text: item.text, page: item.page }],
        heading: item.heading,
        type: item.type,
        tables: item.tables,
        qualifiers: item.qualifiers,
      }));
      const part = chunkDocumentPages(pseudoPages, sourceFile, nextId);
      merged.push(...part);
      nextId += part.length;
    }
    for (let i = 0; i < merged.length; i++) merged[i].neighboringIds = { prev: merged[i - 1]?.id, next: merged[i + 1]?.id };
    return merged;
  }

  let currentChunkSentences: SentenceItem[] = [];
  let currentWords = 0;
  let currentHeading = allDocSentences[0].heading;
  let currentType: ChunkType = allDocSentences[0].type;
  let currentTables: TableData[] = [];
  let currentQualifiers: string[] = [];

  for (let i = 0; i < allDocSentences.length; i++) {
    const s = allDocSentences[i];
    const sWords = s.text.split(/\s+/).filter(Boolean);

    currentChunkSentences.push({ text: s.text, page: s.page });
    currentWords += sWords.length;
    if (s.heading) currentHeading = s.heading;
    currentType = s.type;
    currentTables.push(...s.tables);
    currentQualifiers = [...new Set([...currentQualifiers, ...s.qualifiers])];

    if (currentWords >= CHUNK_SIZE || i === allDocSentences.length - 1) {
      const pageStart = currentChunkSentences[0].page;
      const pageEnd = currentChunkSentences[currentChunkSentences.length - 1].page;
      const rawText = currentChunkSentences.map(it => it.text).join(' ');

      const prefixedText = `Section: ${currentHeading}\n${rawText}`;

      const tokens = tokenizeBM25(prefixedText);
      const termFreqs: Record<string, number> = {};
      for (const t of tokens) {
        termFreqs[t] = (termFreqs[t] || 0) + 1;
      }

      chunks.push({
        id: `${sourceFile.replace(/\.[^/.]+$/, '')}_chunk_${chunkCount++}`,
        heading: currentHeading,
        sectionTitle: currentHeading,
        text: prefixedText,
        sourceFile,
        pageStart,
        pageEnd,
        sentences: [...currentChunkSentences],
        type: currentType,
        tables: [...new Map(currentTables.map(table => [`${table.page}:${table.heading}`, table])).values()],
        neighboringIds: {},
        qualifiers: currentQualifiers,
        termFreqs,
        docLen: tokens.length,
      });

      let overlapWords = 0;
      const overlapSentences: SentenceItem[] = [];
      for (let j = currentChunkSentences.length - 1; j >= 0; j--) {
        const itemWords = currentChunkSentences[j].text.split(/\s+/).length;
        if (overlapWords + itemWords <= CHUNK_OVERLAP) {
          overlapSentences.unshift(currentChunkSentences[j]);
          overlapWords += itemWords;
        } else {
          break;
        }
      }

      currentChunkSentences = overlapSentences;
      currentWords = overlapWords;
      currentTables = [];
      currentQualifiers = [];
      currentType = 'text';
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    chunks[i].neighboringIds = {
      prev: chunks[i - 1]?.id,
      next: chunks[i + 1]?.id,
    };
  }

  return chunks;
}

function computeBM25Stats(chunks: Chunk[]): BM25Stats {
  const totalDocs = chunks.length;
  let totalLength = 0;
  const docFreq: Record<string, number> = {};

  for (const chunk of chunks) {
    totalLength += chunk.docLen;
    for (const term of Object.keys(chunk.termFreqs)) {
      docFreq[term] = (docFreq[term] || 0) + 1;
    }
  }

  const avgDocLen = totalDocs > 0 ? totalLength / totalDocs : 1;
  const idf: Record<string, number> = {};

  for (const [term, df] of Object.entries(docFreq)) {
    idf[term] = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
  }

  return {
    avgDocLen,
    totalDocs,
    idf,
  };
}

async function main() {
  const isForced = process.argv.includes('--force');
  const projectRoot = path.resolve(__dirname, '..');
  const outPath = path.join(projectRoot, 'public', 'index.json');

  if (fs.existsSync(outPath) && !isForced) {
    console.log(`[build-index] ${outPath} already exists. Skipping rebuild (use --force to re-generate).`);
    return;
  }

  const sourceDir = path.join(projectRoot, 'public', 'pdfs');
  const pdfFiles = fs
    .readdirSync(sourceDir)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .sort();

  const fontUrl = path.resolve(projectRoot, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/') + '/';

  console.log(`[build-index] Processing ${pdfFiles.length} source PDF(s)...`);

  const allChunks: Chunk[] = [];
  let chunkIdCounter = 0;

  // Build vocabulary lookup across all pages
  const termPages: Record<string, Array<{ file: string; page: number }>> = {};

  for (const file of pdfFiles) {
    const filePath = path.join(sourceDir, file);
    const { pages, pageCount, emptyPages } = await extractPagesFromPdf(filePath, fontUrl, file);

    // Record words into termPages
    for (const p of pages) {
      for (const s of p.sentences) {
        const tokens = tokenizeBM25(s.text);
        for (const t of tokens) {
          if (!termPages[t]) termPages[t] = [];
          if (!termPages[t].some(tp => tp.file === file && tp.page === p.pageNum)) {
            termPages[t].push({ file, page: p.pageNum });
          }
        }
      }
    }

    const fileChunks = chunkDocumentPages(pages, file, chunkIdCounter);
    chunkIdCounter += fileChunks.length;
    allChunks.push(...fileChunks);

    console.log(`  • ${file}: ${pageCount} pages -> ${fileChunks.length} chunks (empty pages: ${emptyPages.length})`);
  }

  console.log(`[build-index] Total chunks generated: ${allChunks.length}`);
  console.log(`[build-index] Precomputed corpus vocabulary index: ${Object.keys(termPages).length} unique terms indexed.`);

  const bm25Stats = computeBM25Stats(allChunks);

  console.log(`[build-index] Loading embedding model '${MODEL_NAME}' (q8)...`);
  const extractor = await pipeline('feature-extraction', MODEL_NAME, { dtype: 'q8' });

  const dim = 384;
  const totalChunks = allChunks.length;
  const allVectors = new Float32Array(totalChunks * dim);

  console.log(`[build-index] Embedding ${totalChunks} chunks in batches of ${BATCH_SIZE}...`);
  const startTime = Date.now();

  for (let i = 0; i < totalChunks; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.text);

    const output = await extractor(texts, {
      pooling: 'mean',
      normalize: true,
    });

    const data = Float32Array.from(output.data as Float32Array);
    allVectors.set(data, i * dim);

    const progress = Math.min(i + BATCH_SIZE, totalChunks);
    const pct = ((progress / totalChunks) * 100).toFixed(1);
    process.stdout.write(`\r  Progress: ${progress}/${totalChunks} chunks (${pct}%)`);
  }
  console.log(`\n[build-index] Embedding finished in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);

  const vectorBuffer = Buffer.from(allVectors.buffer, allVectors.byteOffset, allVectors.byteLength);
  const base64Vectors = vectorBuffer.toString('base64');

  const indexData: IndexData = {
    model: MODEL_NAME,
    dim,
    bm25: bm25Stats,
    termPages,
    chunks: allChunks,
    vectors: base64Vectors,
  };

  const jsonContent = JSON.stringify(indexData);
  fs.writeFileSync(outPath, jsonContent, 'utf-8');

  const fileSizeBytes = fs.statSync(outPath).size;
  console.log(`[build-index] Saved index to ${outPath} (${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB)`);
}

main().catch(err => {
  console.error('[build-index] Error:', err);
  process.exit(1);
});
