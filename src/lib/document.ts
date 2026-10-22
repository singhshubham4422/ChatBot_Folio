import type { Chunk, PageRecord } from '../types';

export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_PAGES = 2000;
const TARGET_WORDS = 450;
const OVERLAP_WORDS = 70;
const STOP = new Set('a an and are as at be been but by can do for from had has have he her hers him his i if in into is it its may me more most my of on or our ours she so than that the their theirs them then there these they this those to was we were what when where which who will with would you your'.split(' '));
function textLooksUsable(text: string) {
  const compact = text.replace(/\s/g, '');
  const meaningful = [...compact].filter(character => /[\p{L}\p{N}]/u.test(character)).length;
  return text.length >= 80 && compact.length > 0 && meaningful / compact.length >= 0.15 && !text.includes('\uFFFD');
}
export async function hashFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function chunkPage(page: PageRecord): Chunk[] {
  if (!page.text.trim() || page.quality === 'failed') return [];
  const text = page.text;
  const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const blocks: { text: string; start: number; end: number; heading?: string }[] = [];
  let cursor = 0; let heading = '';
  for (const paragraph of paragraphs) {
    const start = text.indexOf(paragraph, cursor); if (start < 0) continue; cursor = start + paragraph.length;
    const lines = paragraph.split('\n').map(l => l.trim()).filter(Boolean);
    const first = lines[0] ?? '';
    const isHeading = first.length < 100 && (first === first.toUpperCase() || /^\d+(?:\.\d+)*\s+[A-Z]/.test(first) || /:$/.test(first));
    if (isHeading) { heading = first; blocks.push({ text: paragraph, start, end: start + paragraph.length, heading }); continue; }
    const listish = /^\s*(?:[-*•]|\d+[.)])\s/.test(first);
    const tableish = /\|/.test(first);
    blocks.push({ text: paragraph, start, end: start + paragraph.length, heading: heading || (listish ? 'List' : tableish ? 'Table' : undefined) });
  }
  if (!blocks.length) blocks.push({ text, start: 0, end: text.length });
  const chunks: Chunk[] = [];
  let current: typeof blocks = []; let count = 0;
  const emit = (start: number, end: number, section?: string) => {
    const content = text.slice(start, end).trim();
    if (content) chunks.push({ id: `${page.page}:${start}`, page: page.page, text: content, start, end, section, quality: page.quality });
  };
  const flush = (carry: boolean) => {
    if (!current.length) return;
    const start = current[0].start; const end = current[current.length - 1].end;
    const section = [...current].reverse().find(b => b.heading)?.heading; emit(start, end, section);
    if (!carry) { current = []; count = 0; return; }
    const span = text.slice(start, end); const words = [...span.matchAll(/\S+/g)];
    if (words.length <= OVERLAP_WORDS) { current = [{ text: span, start, end, heading: section }]; count = words.length; return; }
    const tail = words.slice(-OVERLAP_WORDS); const tailStart = start + (tail[0].index ?? 0);
    current = [{ text: text.slice(tailStart, end), start: tailStart, end, heading: section }]; count = tail.length;
  };
  for (const block of blocks) {
    const words = block.text.split(/\s+/).length;
    if (words > TARGET_WORDS) {
      let prefixStart = block.start;
      if (current.length && count <= 10 && current.some(item => item.heading)) { prefixStart = current[0].start; current = []; count = 0; }
      else if (current.length) flush(false);
      const positions = [...block.text.matchAll(/\S+/g)];
      for (let from = 0; from < positions.length; from += TARGET_WORDS - OVERLAP_WORDS) {
        const to = Math.min(from + TARGET_WORDS, positions.length);
        const start = from === 0 ? prefixStart : block.start + (positions[from].index ?? 0);
        const end = block.start + (positions[to - 1].index ?? 0) + positions[to - 1][0].length;
        emit(start, end, block.heading);
        if (to === positions.length) break;
      }
      continue;
    }
    if (current.length && count + words > TARGET_WORDS) {
      flush(true);
      if (count + words > TARGET_WORDS) { current = []; count = 0; }
    }
    current.push(block); count += words;
  }
  if (current.length && (count > OVERLAP_WORDS || !chunks.length)) flush(false);
  return chunks;
}
export async function parsePdf(
  file: Blob,
  onPage: (page: PageRecord, chunks: Chunk[], completed: number, total: number) => Promise<void>,
  runOcr: boolean,
  signal: AbortSignal,
  onStage?: (phase: 'parsing' | 'ocr' | 'indexing', page: number, total: number) => void,
  skipPages: Set<number> = new Set(),
): Promise<{ pageCount: number; failedPages: number[]; lowQualityPages: number[]; textPages: number; ocrPages: number }> {
  if (file.size > MAX_PDF_BYTES) throw new Error('This PDF is larger than the 100 MB limit.');
  const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
  if (!header.includes('%PDF-')) throw new Error('This file does not contain a valid PDF header. Choose a readable PDF and retry.');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), maxImageSize: 4096 * 4096 }).promise;
  if (pdf.numPages > MAX_PDF_PAGES) { await pdf.destroy(); throw new Error(`This PDF has ${pdf.numPages.toLocaleString()} pages. The current processing limit is ${MAX_PDF_PAGES.toLocaleString()} pages.`); }
  const failedPages: number[] = []; const lowQualityPages: number[] = []; let textPages = 0; let ocrPages = 0; let ocrWorker: { recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> } | undefined;
  try {
    for (let number = 1; number <= pdf.numPages; number += 1) {
      if (signal.aborted) throw new DOMException('Processing cancelled.', 'AbortError');
      if (skipPages.has(number)) continue;
      onStage?.('parsing', number, pdf.numPages);
      let pageRecord: PageRecord;
      try {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        let text = content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        let quality: PageRecord['quality'] = textLooksUsable(text) ? 'good' : 'thin';
        let extractionError: string | undefined;
        if (quality === 'good') textPages += 1;
        // OCR only low-text pages and only when the user has enabled browser OCR.
        if (runOcr && quality !== 'good') {
          onStage?.('ocr', number, pdf.numPages);
          try {
            if (!ocrWorker) { const { createWorker } = await import('tesseract.js'); ocrWorker = await createWorker('eng'); }
            const viewport = page.getViewport({ scale: 1.25 }); const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d')!, viewport, background: 'white' }).promise;
            const recognized = await ocrWorker.recognize(canvas); const ocrText = recognized.data.text.replace(/\s+/g, ' ').trim();
            canvas.width = 0; canvas.height = 0;
            if (ocrText.length > text.length) { text = ocrText; quality = textLooksUsable(ocrText) ? 'ocr' : 'thin'; }
            if (quality === 'ocr') ocrPages += 1;
          } catch (error) { quality = text ? 'thin' : 'failed'; extractionError = error instanceof Error ? `OCR: ${error.message.slice(0, 150)}` : 'OCR could not read this page.'; }
        }
        page.cleanup();
        pageRecord = { page: number, text, quality, error: extractionError };
      } catch (error) {
        if (signal.aborted) throw error;
        pageRecord = { page: number, text: '', quality: 'failed', error: error instanceof Error ? error.message.slice(0, 180) : 'Page could not be extracted.' };
        failedPages.push(number);
      }
      if (pageRecord.quality === 'thin') lowQualityPages.push(number);
      onStage?.('indexing', number, pdf.numPages);
      await onPage(pageRecord, chunkPage(pageRecord), number, pdf.numPages);
    }
  } finally {
    if (ocrWorker) await ocrWorker.terminate().catch(() => undefined);
    await pdf.destroy();
  }
  return { pageCount: pdf.numPages, failedPages, lowQualityPages, textPages, ocrPages };
}

export function rankChunks(query: string, chunks: Chunk[], limit = 5): Chunk[] {
  const terms = (query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(t => !STOP.has(t));
  if (!terms.length || !chunks.length) return [];
  const tokenized = chunks.map(c => ({ chunk: c, words: (c.text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(t => !STOP.has(t)) }));
  const avgLen = tokenized.reduce((sum, d) => sum + d.words.length, 0) / tokenized.length || 1;
  const uniqueQuery = [...new Set(terms)];
  const scores = tokenized.map(doc => {
    let score = 0;
    for (const term of uniqueQuery) {
      let tf = 0; for (const word of doc.words) if (word === term) tf += 1;
      if (!tf) continue;
      const df = tokenized.reduce((n, item) => n + (item.words.includes(term) ? 1 : 0), 0);
      const idf = Math.log(1 + (tokenized.length - df + 0.5) / (df + 0.5));
      const k1 = 1.2; const b = 0.75;
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.words.length / avgLen));
    }

    return { chunk: doc.chunk, score };
  });
  return scores.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.chunk);
}

export function isWholeDocumentQuery(query: string): boolean {
  return /\b(summar(?:y|ize|ise)|key points?|main (?:ideas?|points?|conclusions?)|what is this document about|important dates?|important figures?|compare (?:the )?(?:main )?sections?)\b/i.test(query);
}

export function selectChunksForQuestion(query: string, chunks: Chunk[], maxChars = 18_000): Chunk[] {
  if (!chunks.length) return [];
  if (!isWholeDocumentQuery(query)) return rankChunks(query, chunks, 6);
  const selected: Chunk[] = [];
  let size = 0;
  for (const chunk of [...chunks].sort((a, b) => a.page - b.page || a.start - b.start)) {
    const words = new Set(chunk.text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);
    const duplicate = selected.some(existing => {
      const existingWords = new Set(existing.text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);
      const overlap = [...words].filter(word => existingWords.has(word)).length;
      return chunk.text.trim() === existing.text.trim() || (overlap / Math.max(1, Math.min(words.size, existingWords.size))) >= 0.82;
    });
    if (duplicate) continue;
    if (size + chunk.text.length > maxChars && selected.length) break;
    selected.push(chunk);
    size += chunk.text.length;
    if (selected.length === 5) break;
  }
  return selected;
}

export function exactPageLookup(query: string, pageCount?: number): string | undefined {
  const match = query.match(/^\s*(?:how many pages(?: does (?:this )?(?:document|it) have)?|(?:what(?:'s| is)?\s+)?(?:the\s+)?(?:number of\s+)?pages?(?:\s+(?:are there|does .+ have))?)\??\s*$/i);
  return match && pageCount !== undefined ? `This document has ${pageCount} pages.` : undefined;
}
export function deterministicAnswer(query: string, info: { fileName?: string; pageCount?: number }): string | undefined {
  const pageAnswer = exactPageLookup(query, info.pageCount); if (pageAnswer) return pageAnswer;
  if (/^\s*(?:what(?: is|'s) (?:the )?)?(?:(?:pdf|document|file) (?:name|title|called)|(?:name|title) of (?:the )?(?:pdf|document|file))\??\s*$/i.test(query) && info.fileName) return `The file name is ${info.fileName}.`;
  return undefined;
}
