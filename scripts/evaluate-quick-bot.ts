import { readFile } from 'node:fs/promises';
import { pipeline } from '@huggingface/transformers';
import { CONFIG } from '../src/engine/config.ts';
import { VectorStore } from '../src/engine/search.ts';
import { isUnsupportedDocumentQuestion } from '../src/engine/queryAnalysis.ts';
import { answerOnline, getProviderConfig, type OnlineProvider } from '../api/onlineProvider.ts';
import { loadLocalEnv } from './load-local-env.ts';

type Case = { id: string; question: string; files: string[]; pages?: number[]; expectedFacts: string[]; absent?: boolean };

export const regressionCases: Case[] = [
  { id: '01', question: 'What academic year does the BITSAT-2026 brochure cover?', files: ['BITSAT-2026_brochure.pdf'], pages: [2], expectedFacts: ['2026-27'] },
  { id: '02', question: 'How many times may a candidate appear in BITSAT-2026?', files: ['BITSAT-2026_brochure.pdf'], pages: [6], expectedFacts: ['two times'] },
  { id: '03', question: 'What is the BITSAT-2026 Session-2 application window?', files: ['BITSAT-2026_brochure.pdf'], pages: [6], expectedFacts: ['20th April', '02nd May', '2026'] },
  { id: '04', question: 'How many total questions are in the BITSAT-2026 test?', files: ['BITSAT-2026_brochure.pdf'], pages: [7], expectedFacts: ['130'] },
  { id: '05', question: 'What are the 12th-grade eligibility requirements for BITSAT-2026?', files: ['BITSAT-2026_brochure.pdf'], pages: [4, 5], expectedFacts: ['2025', '2026', '12th'] },
  { id: '06', question: 'When is the admission application form submitted after BITSAT-2026?', files: ['BITSAT-2026_brochure.pdf'], pages: [8], expectedFacts: ['29 April', '01 June', '2026'] },
  { id: '07', question: 'What are the modes of admission for Integrated First Degree programmes?', files: ['Admission_Modality_FD.pdf'], pages: [1], expectedFacts: ['BITSAT', 'Board Topper', 'International'] },
  { id: '08', question: 'What is the First Degree Board Topper admission scheme?', files: ['Admission_Modality_FD.pdf'], pages: [8], expectedFacts: ['Board topper'] },
  { id: '09', question: 'What minimum aggregate marks are required for First Degree admission?', files: ['Admission_Modality_FD.pdf'], pages: [2, 11], expectedFacts: ['75%'] },
  { id: '10', question: 'What First Degree tuition fees are listed in the brochure?', files: ['Admission_Modality_FD.pdf'], pages: [30], expectedFacts: ['Tuition Fees'] },
  { id: '11', question: 'What fees are listed for ISA students?', files: ['Admission_Modality_FD.pdf'], pages: [29, 35], expectedFacts: ['ISA', 'Admission fees'] },
  { id: '12', question: 'What academic year and programmes does the Higher Degree brochure cover?', files: ['HD_Brochure_2025_26.pdf'], pages: [1, 5], expectedFacts: ['2025-26', 'M.E.', 'M.Pharm'] },
  { id: '13', question: 'How does Higher Degree admission modality work?', files: ['HD_Brochure_2025_26.pdf'], pages: [5], expectedFacts: ['GATE', 'BITS HD Test'] },
  { id: '14', question: 'What financial assistance is described for Higher Degree students?', files: ['HD_Brochure_2025_26.pdf'], pages: [7], expectedFacts: ['stipend', 'fee waiver'] },
  { id: '15', question: 'What are the Higher Degree important dates and deadlines?', files: ['HD_Brochure_2025_26.pdf'], pages: [8], expectedFacts: ['2025'] },
  { id: '16', question: 'Where are the Higher Degree programme eligibility criteria?', files: ['HD_Brochure_2025_26.pdf'], pages: [10], expectedFacts: ['Eligibility Criteria'] },
  { id: '17', question: 'What is the BITS HD Test format?', files: ['HD_Brochure_2025_26.pdf'], pages: [13], expectedFacts: ['correct answer', 'penalty'] },
  { id: '18', question: 'Compare First Degree and Higher Degree admission years.', files: ['Admission_Modality_FD.pdf', 'HD_Brochure_2025_26.pdf'], pages: [1], expectedFacts: ['2022', '2025-26'] },
  { id: '19', question: 'Which document applies to BITSAT-2026 rather than the older First Degree brochure?', files: ['BITSAT-2026_brochure.pdf', 'Admission_Modality_FD.pdf'], pages: [1, 2], expectedFacts: ['BITSAT-2026', '2026-27'] },
  { id: '20', question: 'What is the admission policy for a programme not mentioned in these documents?', files: [], expectedFacts: [], absent: true },
];

const live = process.argv.includes('--live');
loadLocalEnv();
const providerConfig = getProviderConfig(process.env);
const configuredProviders: OnlineProvider[] = [
  ...(providerConfig.groqKey ? ['groq' as const] : []),
  ...(providerConfig.geminiKey ? ['gemini' as const] : []),
];
if (live) {
  const requests = regressionCases.length * configuredProviders.length;
  console.log(JSON.stringify({ liveEvaluation: true, providers: configuredProviders, credentialPresenceOnly: true, models: { groq: providerConfig.groqModel, gemini: providerConfig.geminiModel }, requests, warning: 'This will make live generation requests and may consume provider quota or incur usage charges.' }));
  if (!configuredProviders.length) throw new Error('No provider credentials are configured for --live.');
} else {
  console.log(JSON.stringify({ liveEvaluation: false, configuredProviders, credentialPresenceOnly: true, models: { groq: providerConfig.groqModel, gemini: providerConfig.geminiModel }, instruction: 'Retrieval-only evaluation ran. Pass --live explicitly to call configured providers.' }));
}

const raw = await readFile('public/index.json', 'utf8');
const store = new VectorStore();
await store.load(`data:application/json,${encodeURIComponent(raw)}`);
const embedder = await pipeline('feature-extraction', CONFIG.MODEL_NAME, { dtype: 'q8' });
const rows = [];

for (const item of regressionCases) {
  const started = Date.now();
  const output = await embedder(item.question, { pooling: 'mean', normalize: true });
  const search = store.search(item.question, Float32Array.from(output.data as Float32Array), 3);
  const explicitAbstention = item.absent && isUnsupportedDocumentQuestion(item.question);
  const routedResults = search.results.filter(hit => hit.routingBoost > 0);
  const effectiveResults = item.absent ? search.results : (routedResults.length ? routedResults : search.results);
  const hits = effectiveResults.map(hit => ({ file: hit.sourceFile, page: hit.pageStart, score: Number(hit.score.toFixed(3)) }));
  const fileHit = item.absent ? search.topScore < CONFIG.THRESHOLD : effectiveResults.some(hit => item.files.includes(hit.sourceFile));
  const pageHit = item.absent || !item.pages ? fileHit : effectiveResults.some(hit => item.files.includes(hit.sourceFile) && item.pages!.includes(hit.pageStart));
  const evidence = effectiveResults.map(hit => ({ page: hit.pageStart, fileName: hit.sourceFile, text: `${hit.text}\n${(hit.tables ?? []).map(table => `${table.heading}\n${table.columns.join(' | ')}\n${table.rows.map(row => row.join(' | ')).join('\n')}`).join('\n')}` }));
  const liveResults = live ? await Promise.all(configuredProviders.map(async provider => {
    const providerStarted = Date.now();
    try {
      const result = await answerOnline({ question: item.question, context: [], evidence, consent: true, mode: 'online' }, { ...providerConfig, primaryProvider: provider, groqKey: provider === 'groq' ? providerConfig.groqKey : undefined, geminiKey: provider === 'gemini' ? providerConfig.geminiKey : undefined });
      const lower = result.answer.toLowerCase();
      return { provider, model: provider === 'groq' ? providerConfig.groqModel : providerConfig.geminiModel, latencyMs: Date.now() - providerStarted, answer: result.answer, expectedFactsFound: item.expectedFacts.filter(fact => lower.includes(fact.toLowerCase())) };
    } catch (error) {
      return { provider, model: provider === 'groq' ? providerConfig.groqModel : providerConfig.geminiModel, latencyMs: Date.now() - providerStarted, error: error instanceof Error ? error.message : 'provider_failure' };
    }
  })) : undefined;
  rows.push({ id: item.id, question: item.question, expectedFacts: item.expectedFacts, expectedFiles: item.files, expectedPages: item.pages ?? [], hitAt3: fileHit, sourcePageHitAt3: pageHit, unsupportedAbstention: item.absent ? explicitAbstention : null, topScore: Number(search.topScore.toFixed(3)), hits, latencyMs: Date.now() - started, liveResults });
}

const hitAt3 = rows.filter(row => row.hitAt3).length;
const pageHitAt3 = rows.filter(row => row.sourcePageHitAt3).length;
const sourceHitFailures = rows.filter(row => !row.hitAt3).map(row => ({ id: row.id, question: row.question, expectedFiles: row.expectedFiles, retrieved: row.hits.map(hit => ({ file: hit.file, page: hit.page })) }));
const sourcePageFailures = rows.filter(row => !row.sourcePageHitAt3).map(row => ({ id: row.id, question: row.question, expected: { files: row.expectedFiles, pages: row.expectedPages }, retrieved: row.hits.map(hit => ({ file: hit.file, page: hit.page })) }));
const unsupportedRows = rows.filter(row => row.unsupportedAbstention !== null);
console.log(JSON.stringify({
  model: CONFIG.MODEL_NAME,
  cases: rows.length,
  metrics: {
    sourceHitAt3: { value: `${hitAt3}/${rows.length}`, definition: 'At least one of the top three chunks comes from an expected source document; absent cases pass only when the retrieval score is below the out-of-context threshold.' },
    sourcePageHitAt3: { value: `${pageHitAt3}/${rows.length}`, definition: 'At least one of the top three chunks matches both an expected source document and an expected page.' },
  },
  failures: { sourceHitAt3: sourceHitFailures, sourcePageHitAt3: sourcePageFailures },
  unsupportedQuestionAbstention: { value: `${unsupportedRows.filter(row => row.unsupportedAbstention).length}/${unsupportedRows.length}`, definition: 'An explicitly out-of-scope question is rejected by the same scope guard used by the application, regardless of arbitrary similarity matches.' },
  generation: live ? 'live' : 'not_live_tested',
  rows,
}, null, 2));
