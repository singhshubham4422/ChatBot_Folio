import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const indexPath = join(root, 'public', 'quick-bot', 'index.json');
const modelPath = join(root, 'public', 'quick-bot', 'smart-model.json');
const STOP = new Set('a an and are as at be by can does for from how i in is it of on or that the this to was what when where which who why with'.split(' '));

function tokens(value) {
  return [...new Set((value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter(token => !STOP.has(token)))];
}

const index = JSON.parse(await readFile(indexPath, 'utf8'));
const documents = index.chunks.map(chunk => ({ id: chunk.id, fileName: chunk.fileName, page: chunk.page, text: chunk.text, terms: tokens(chunk.text) }));
const documentFrequency = new Map();
for (const document of documents) for (const term of document.terms) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
const vocabulary = [...documentFrequency.entries()]
  .filter(([, frequency]) => frequency <= documents.length * 0.65)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 1600)
  .map(([term]) => term);
const allowed = new Set(vocabulary);
const idf = Object.fromEntries(vocabulary.map(term => [term, Math.log((documents.length + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1]));
const passages = documents.map(document => ({
  id: document.id,
  fileName: document.fileName,
  page: document.page,
  text: document.text,
  weights: Object.fromEntries(document.terms.filter(term => allowed.has(term)).map(term => [term, idf[term]])),
}));
const model = { version: 1, kind: 'smart-quickbot-tfidf-router', trainedAt: new Date().toISOString(), vocabulary, idf, passages };
await writeFile(modelPath, `${JSON.stringify(model)}\n`, 'utf8');
console.log(`Trained Smart Quick Bot from ${documents.length} PDF passages using ${vocabulary.length} terms.`);
