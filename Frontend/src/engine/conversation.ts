export type Intent = 'GREETING' | 'THANKS' | 'GOODBYE' | 'ABOUT_BOT' | 'DOC_QUESTION' | 'FOLLOWUP' | 'CHITCHAT' | 'UNSAFE';

export type ConversationTurn = { role: 'user' | 'assistant'; text: string };
export type Citation = { id: number; file: string; page: number };

const FOLLOWUP_WORDS = /^(and|what about|how about|why|when|where|is it|are they|tell me more|explain that|give me details|what about for)\b/i;
const DOCUMENT_WORDS = /\b(bits|admission|admissions|bitsat|first degree|higher degree|m\.(?:e|pharm)\.?|ph\.?d|board topper|fees?|fee|hostel|eligib|document|date|deadline|campus|goa|pilani|program|course|scholarship|stipend|application|test center|marking)\b/i;

export function classifyIntent(input: string): Intent {
  const q = input.trim().replace(/[!?.,]+$/g, '').toLowerCase();
  if (/\b(ignore|disregard|forget)\b.{0,40}\b(previous|instructions|rules|system)\b/i.test(q) || /\b(prompt injection|reveal (the )?system)\b/i.test(q)) return 'UNSAFE';
  if (/^(hi|hello|hey|namaste|good morning|good afternoon|good evening)\b/i.test(q)) return 'GREETING';
  if (/^(thanks|thank you|thx|appreciate it)\b/i.test(q)) return 'THANKS';
  if (/^(bye|goodbye|see you|take care)\b/i.test(q)) return 'GOODBYE';
  if (/\b(what can you do|who are you|what is smart bot|how can you help)\b/i.test(q)) return 'ABOUT_BOT';
  if (FOLLOWUP_WORDS.test(q) || /^(why|how)\??$/i.test(q) || (q.split(/\s+/).length <= 3 && /^(and|that|those|it|they|same)\b/i.test(q))) return 'FOLLOWUP';
  if (DOCUMENT_WORDS.test(q)) return 'DOC_QUESTION';
  return 'CHITCHAT';
}

export const STARTER_CHIPS = ['BITSAT 2026 dates', 'Direct admission for Board toppers', 'Higher Degree fees'];

export function smallTalkReply(intent: Exclude<Intent, 'DOC_QUESTION' | 'FOLLOWUP' | 'CHITCHAT' | 'UNSAFE'>): string {
  if (intent === 'THANKS') return 'You’re welcome! If you have another BITS admissions question, I’m here.';
  if (intent === 'GOODBYE') return 'Goodbye! Come back whenever you need help with BITS admissions.';
  if (intent === 'ABOUT_BOT') return 'I’m Smart Bot. I can answer questions from the official BITS admissions documents, including BITSAT 2026, First Degree, and Higher Degree admissions.';
  return 'Hi! I can answer questions about BITS Pilani admissions: BITSAT 2026, First Degree and Higher Degree. What would you like to know?';
}

export function rewriteFollowup(message: string, history: ConversationTurn[]): string {
  const previous = [...history].reverse().find(turn => turn.role === 'user')?.text ?? '';
  const context = history.map(turn => turn.text).join(' ');
  const entities = [...new Set((context.match(/\b(?:BITSAT(?:-?20\d{2})?|First Degree|Higher Degree|M\.E\.?|M\.Pharm|Ph\.D\.?|Goa|Pilani|Hyderabad|Dubai|20\d{2})\b/gi) ?? []))];
  const subject = entities.length ? ` about ${entities.join(', ')}` : '';
  if (!previous) return message;
  if (/^what about (?:for )?goa/i.test(message)) return `${message} in the context of ${previous}`;
  if (/^and (?:the )?(?:dates|documents|fees)/i.test(message)) return `${message} for ${previous}`;
  if (/^(explain that simply|give me details|tell me more|why)\??$/i.test(message)) return `${message} for ${previous}${subject}`;
  return `${message}${subject} (following the previous question: ${previous})`.slice(0, 300);
}

export function parseCitations(text: string, validIds: Set<number>): { text: string; citations: number[] } {
  const citations: number[] = [];
  const cleaned = text.replace(/\[(\d+)\]/g, (_match, raw: string) => {
    const id = Number(raw);
    if (validIds.has(id)) { citations.push(id); return `[${id}]`; }
    return '';
  });
  return { text: cleaned.replace(/[ \t]{2,}/g, ' ').trim(), citations: [...new Set(citations)] };
}

export function stripNext(text: string): { text: string; next?: string } {
  const match = text.match(/(?:^|\n)\s*NEXT:\s*(.+?)\s*$/im);
  return match ? { text: text.replace(match[0], '').trim(), next: match[1].trim() } : { text: text.trim() };
}

function numberTokens(text: string): string[] {
  return (text.match(/(?:₹|Rs\.?\s*)?\d[\d,]*(?:\.\d+)?\s*%?/gi) ?? []).map(value => value.replace(/[₹,\s]/g, '').toLowerCase());
}

export function numbersAreGrounded(answer: string, evidence: string): boolean {
  const source = numberTokens(evidence);
  const answerWithoutCitations = answer.replace(/\[\d+\]/g, '');
  return numberTokens(answerWithoutCitations).every(value => source.includes(value));
}

export function sanitizeMarkdown(input: string): Array<{ type: 'text' | 'bold' | 'bullet' | 'break'; text?: string }> {
  const safe = input.replace(/<[^>]*>/g, '').replace(/`[^`]*`/g, '').trim();
  const result: Array<{ type: 'text' | 'bold' | 'bullet' | 'break'; text?: string }> = [];
  for (const line of safe.split(/\r?\n/)) {
    if (!line.trim()) { result.push({ type: 'break' }); continue; }
    const bullet = line.match(/^\s*[-*•]\s+(.+)/);
    result.push(bullet ? { type: 'bullet', text: bullet[1] } : { type: 'text', text: line });
  }
  return result;
}

export function hasLongVerbatimCopy(answer: string, evidence: string, limit = 15): boolean {
  const words = answer.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const sourceWords = evidence.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (let i = 0; i <= words.length - limit; i++) {
    for (let j = 0; j <= sourceWords.length - limit; j++) {
      if (words.slice(i, i + limit).every((word, offset) => word === sourceWords[j + offset])) return true;
    }
  }
  return false;
}
