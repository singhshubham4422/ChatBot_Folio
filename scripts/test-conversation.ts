import { answerOnline, getProviderConfig, onlineAvailability, type OnlineProvider } from '../api/onlineProvider.ts';
import { classifyIntent, hasLongVerbatimCopy, numbersAreGrounded, rewriteFollowup, type ConversationTurn } from '../src/engine/conversation.ts';
import { loadLocalEnv } from './load-local-env.ts';

loadLocalEnv();

const scenarios: Array<{ text: string; history?: ConversationTurn[]; coverage: string; final: string }> = [
  { text: 'hello', coverage: 'NONE', final: 'Hi! I can answer questions about BITS Pilani admissions.' },
  { text: 'What is the direct admission policy for Board toppers?', coverage: 'FULL', final: 'Board toppers can be considered for direct admission [1].' },
  { text: 'what about the documents needed?', history: [{ role: 'user', text: 'What is the direct admission policy for Board toppers?' }], coverage: 'FULL', final: 'The documents needed for that policy are listed in the admissions document [1].' },
  { text: 'fees', coverage: 'FULL', final: 'Which programme or admission scheme do you mean?' },
  { text: 'First Degree', coverage: 'FULL', final: 'First Degree fees are listed in the fee table [1].' },
  { text: 'explain that simply', history: [{ role: 'user', text: 'First Degree fees' }], coverage: 'FULL', final: 'In short, the First Degree fee table lists the applicable charges [1].' },
  { text: 'fees of hostel', coverage: 'PARTIAL', final: 'The documents only partly cover hostel fees and do not give general domestic figures [1].' },
  { text: 'tell me a joke', coverage: 'NONE', final: 'That is outside what I can help with. I can answer questions about BITS admissions.' },
  { text: 'thanks', coverage: 'NONE', final: 'You are welcome!' },
];

const evidence = [{ page: 1, fileName: 'official-bits-document.pdf', text: 'Board toppers and First Degree admissions are described in the official document. The fee table and hostel scope are listed.' }];

function details(answer: string, source: string) {
  return { allNumbersVerified: numbersAreGrounded(answer, source), longVerbatimCopyOver15Words: hasLongVerbatimCopy(answer, source, 15) };
}

function describe(scenario: typeof scenarios[number]) {
  const intent = classifyIntent(scenario.text);
  const rewritten = intent === 'FOLLOWUP' ? rewriteFollowup(scenario.text, scenario.history ?? []) : scenario.text;
  return { intent, rewritten };
}

console.log('MOCK SCENARIOS');
for (const scenario of scenarios) {
  const { intent, rewritten } = describe(scenario);
  console.log(JSON.stringify({ intent, rewrittenQuery: rewritten, coverage: scenario.coverage, provider: intent === 'DOC_QUESTION' || intent === 'FOLLOWUP' ? 'mock-groq' : 'none', latencyMs: 0, ...details(scenario.final, evidence[0].text), finalText: scenario.final }));
}

const config = getProviderConfig(process.env);
const provider: OnlineProvider | 'none' = config.primaryProvider && (config.groqKey || config.geminiKey) ? config.primaryProvider : 'none';
const live = process.argv.includes('--live');
console.log(JSON.stringify({ realProviderConfigured: onlineAvailability(config), provider: provider === 'none' ? 'none' : provider, credentialPresenceOnly: true }));
if (!live) console.log('LIVE PROVIDER SCENARIOS NOT RUN. Pass --live explicitly to make provider requests.');

if (live && provider !== 'none') {
  console.log('REAL PROVIDER SCENARIOS');
  let shown = 0;
  for (const scenario of scenarios) {
    const { intent, rewritten } = describe(scenario);
    const started = Date.now();
    if (intent !== 'DOC_QUESTION' && intent !== 'FOLLOWUP') {
      console.log(JSON.stringify({ intent, rewrittenQuery: rewritten, coverage: scenario.coverage, provider: 'none', latencyMs: 0, ...details(scenario.final, evidence[0].text), finalText: scenario.final }));
      continue;
    }
    try {
      const result = await answerOnline({ question: rewritten, context: scenario.history?.map(turn => `${turn.role}: ${turn.text}`) ?? [], evidence, consent: true, mode: 'online' }, config);
      const finalText = result.answer;
      console.log(JSON.stringify({ intent, rewrittenQuery: rewritten, coverage: scenario.coverage, provider, latencyMs: Date.now() - started, ...details(finalText, evidence[0].text), finalText }));
      if (shown < 3) { console.log(`REAL_GENERATED_ANSWER_${shown + 1}: ${finalText}`); shown++; }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'provider_failure';
      console.log(JSON.stringify({ intent, rewrittenQuery: rewritten, coverage: scenario.coverage, provider: 'error', latencyMs: Date.now() - started, errorCode: code }));
    }
  }
}
