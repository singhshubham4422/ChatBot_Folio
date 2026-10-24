import { classifyIntent, numbersAreGrounded, rewriteFollowup, type ConversationTurn } from '../src/engine/conversation.ts';

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

for (const scenario of scenarios) {
  const intent = classifyIntent(scenario.text);
  const rewritten = intent === 'FOLLOWUP' ? rewriteFollowup(scenario.text, scenario.history ?? []) : scenario.text;
  const evidence = 'Board toppers and First Degree admissions are described in the official document.';
  const verified = numbersAreGrounded(scenario.final, evidence);
  console.log(JSON.stringify({ intent, rewrittenQuery: rewritten, coverage: scenario.coverage, provider: intent === 'DOC_QUESTION' || intent === 'FOLLOWUP' ? 'mock-groq' : 'none', latencyMs: 0, allNumbersVerified: verified, finalText: scenario.final }));
}
