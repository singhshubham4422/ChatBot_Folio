import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(root, '..');
const dataDir = join(projectRoot, 'Data');
const outputDir = join(projectRoot, 'public', 'quick-bot');
const targetWords = 360;
const overlapWords = 60;

function chunkText(text, page) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let from = 0; from < words.length; from += targetWords - overlapWords) {
    const to = Math.min(from + targetWords, words.length);
    const content = words.slice(from, to).join(' ').trim();
    if (content) chunks.push({ page, text: content });
    if (to === words.length) break;
  }
  return chunks;
}

async function extractPdf(filePath, fileName) {
  const data = new Uint8Array(await readFile(filePath));
  const pdf = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
  const chunks = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map(item => 'str' in item ? item.str : '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    chunks.push(...chunkText(text, pageNumber).map((chunk, index) => ({
      id: `${fileName}:${pageNumber}:${index}`,
      fileName,
      ...chunk,
    })));
    page.cleanup();
  }
  await pdf.destroy();
  return { fileName, pageCount: pdf.numPages, chunks };
}

const files = (await readdir(dataDir, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b));

if (!files.length) throw new Error(`No PDFs found in ${relative(projectRoot, dataDir)}.`);

const documents = [];
for (const fileName of files) {
  const document = await extractPdf(join(dataDir, fileName), fileName);
  documents.push(document);
  console.log(`${fileName}: ${document.pageCount} pages, ${document.chunks.length} chunks`);
}

const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  documents: documents.map(({ fileName, pageCount }) => ({ fileName, pageCount })),
  chunks: documents.flatMap(document => document.chunks),
};

await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, 'index.json'), `${JSON.stringify(payload)}\n`, 'utf8');
await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify({
  version: payload.version,
  generatedAt: payload.generatedAt,
  documents: payload.documents,
  chunkCount: payload.chunks.length,
}, null, 2)}\n`, 'utf8');
console.log(`Wrote ${payload.chunks.length} chunks to ${relative(projectRoot, outputDir)}`);
