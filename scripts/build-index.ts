import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pipeline } from '@huggingface/transformers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SentenceItem {
  text: string;
  page: number;
}

interface Chunk {
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
function extractStructuredTableLines(items: any[]): string[] {
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
  const structuredLines: string[] = [];
  let pendingLabel = '';

  for (const y of sortedY) {
    const rowItems = rows.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]);
    const rowText = rowItems.map(it => it.str.trim()).join(' | ');

    // If row contains fee/number values
    if (/[\d,]+\/-\b|\b\d{4,}\b/.test(rowText) && /[A-Za-z]/.test(rowText)) {
      const parts = rowText.split(' | ');
      const label = (pendingLabel ? pendingLabel + ' ' : '') + parts[0];
      pendingLabel = '';
      const values = parts.slice(1).join(', ');
      structuredLines.push(`${label}: ${values}.`);
    } else if (!/[\d,]+\/-\b/.test(rowText) && rowText.length < 60 && !rowText.includes('III-')) {
      // Continuation of a label
      pendingLabel = (pendingLabel ? pendingLabel + ' ' : '') + rowText.replace(/ \| /g, ' ');
    } else {
      if (pendingLabel) {
        structuredLines.push(pendingLabel + '.');
        pendingLabel = '';
      }
      structuredLines.push(rowText.replace(/ \| /g, ' '));
    }
  }

  if (pendingLabel) {
    structuredLines.push(pendingLabel + '.');
  }

  return structuredLines;
}

async function extractPagesFromPdf(
  filePath: string,
  fontUrl: string,
  fileName: string
): Promise<{ pages: Array<{ pageNum: number; sentences: SentenceItem[]; heading: string }>; pageCount: number; emptyPages: number[] }> {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: fontUrl,
  }).promise;

  const pages: Array<{ pageNum: number; sentences: SentenceItem[]; heading: string }> = [];
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

    // On fee-table pages in Admission Modality (pages 28-31), use coordinate-based row reconstruction
    if (fileName.includes('Admission_Modality') && pageNum >= 28 && pageNum <= 31) {
      const tableLines = extractStructuredTableLines(content.items as any[]);
      for (const line of tableLines) {
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

    pages.push({
      pageNum,
      sentences: pageSentences,
      heading: currentHeading,
    });
  }

  return { pages, pageCount: doc.numPages, emptyPages };
}

function chunkDocumentPages(
  pages: Array<{ pageNum: number; sentences: SentenceItem[]; heading: string }>,
  sourceFile: string,
  startChunkId: number
): Chunk[] {
  const chunks: Chunk[] = [];
  let chunkCount = startChunkId;

  const allDocSentences: Array<{ text: string; page: number; heading: string }> = [];
  for (const p of pages) {
    for (const s of p.sentences) {
      allDocSentences.push({
        text: s.text,
        page: s.page,
        heading: p.heading,
      });
    }
  }

  if (allDocSentences.length === 0) return chunks;

  let currentChunkSentences: SentenceItem[] = [];
  let currentWords = 0;
  let currentHeading = allDocSentences[0].heading;

  for (let i = 0; i < allDocSentences.length; i++) {
    const s = allDocSentences[i];
    const sWords = s.text.split(/\s+/).filter(Boolean);

    currentChunkSentences.push({ text: s.text, page: s.page });
    currentWords += sWords.length;
    if (s.heading) currentHeading = s.heading;

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
        text: prefixedText,
        sourceFile,
        pageStart,
        pageEnd,
        sentences: [...currentChunkSentences],
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
    }
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
