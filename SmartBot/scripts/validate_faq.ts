import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FaqRecord, ConversationIntent } from '../../src/engine/faq';

const root = process.cwd();
const dataDir = resolve(root, 'SmartBot/data');
const pdfDir = resolve(root, 'public/pdfs');

const faqPath = resolve(dataDir, 'faq_dataset.jsonl');
const intentsPath = resolve(dataDir, 'chatbot_intents.jsonl');
const configPath = resolve(dataDir, 'chatbot_config.json');

if (!existsSync(faqPath)) throw new Error(`Missing FAQ dataset at ${faqPath}`);
if (!existsSync(intentsPath)) throw new Error(`Missing intents dataset at ${intentsPath}`);
if (!existsSync(configPath)) throw new Error(`Missing config at ${configPath}`);

const faqLines = readFileSync(faqPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
const faqs: FaqRecord[] = faqLines.map((line, i) => {
  try {
    return JSON.parse(line) as FaqRecord;
  } catch {
    throw new Error(`Invalid JSON on line ${i + 1} of faq_dataset.jsonl`);
  }
});

if (faqs.length !== 1000) {
  throw new Error(`Expected exactly 1,000 FAQ records, found ${faqs.length}`);
}

const ids = new Set<string>();
const questions = new Set<string>();

for (const record of faqs) {
  if (!record.id || typeof record.id !== 'string') throw new Error(`Record missing id: ${JSON.stringify(record)}`);
  if (ids.has(record.id)) throw new Error(`Duplicate id detected: ${record.id}`);
  ids.add(record.id);

  if (!record.question || typeof record.question !== 'string') throw new Error(`Record missing question: ${record.id}`);
  const qNorm = record.question.toLowerCase().trim();
  if (questions.has(qNorm)) throw new Error(`Duplicate question string: "${record.question}" (${record.id})`);
  questions.add(qNorm);

  if (!record.answer || typeof record.answer !== 'string') throw new Error(`Record missing answer: ${record.id}`);
  if (!record.category || typeof record.category !== 'string') throw new Error(`Record missing category: ${record.id}`);
  if (!record.admission_year || typeof record.admission_year !== 'string') throw new Error(`Record missing admission_year: ${record.id}`);
  if (record.intent_type !== 'factual_faq') throw new Error(`Invalid intent_type: ${record.intent_type} in ${record.id}`);
}

const availablePdfs = new Set(readdirSync(pdfDir).map(file => file.toLowerCase()));
for (const record of faqs) {
  for (const ref of record.source_references ?? []) {
    const cleanFile = ref.file.replace(/ \(1\)(?=\.pdf$)/i, '').toLowerCase();
    if (!availablePdfs.has(cleanFile)) {
      throw new Error(`Referenced PDF missing: ${ref.file} in record ${record.id}`);
    }
  }
}

const intentLines = readFileSync(intentsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
const intents: ConversationIntent[] = intentLines.map(l => JSON.parse(l));
const intentTypes = new Set(intents.map(i => i.intent));
if (!intentTypes.has('greeting') || !intentTypes.has('unknown_question') || !intentTypes.has('category_selection')) {
  throw new Error('Crucial conversation intents missing from chatbot_intents.jsonl');
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (!config.version || !config.routing_order) {
  throw new Error('Invalid chatbot_config.json');
}

console.log(`[SmartBot Validation] SUCCESS: All 1,000 FAQ records, ${intents.length} intents, configuration, and PDF references verified.`);
