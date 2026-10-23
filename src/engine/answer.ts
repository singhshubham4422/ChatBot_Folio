import { CONFIG } from './config.ts';
import { tokenizeQuery } from './search.ts';
import type { ScoredChunk } from './types.ts';

export interface BulletItem {
  text: string;
  sourceFile: string;
  page: number;
  dotScore: number;
  keywordScore: number;
  boost: number;
  finalScore: number;
  orderKey: number;
}

export function cleanText(raw: string): string {
  return raw
    .replace(/\b(\d+)\s+(th|st|nd|rd)\b/gi, '$1$2')
    .replace(/\s+([,.:;?!])/g, '$1')
    .replace(/:\.+/g, ':')
    .replace(/\.{2,}/g, '.')
    .replace(/[\r\t\f\v]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BOILERPLATE_PATTERNS = [
  /shall not be responsible/i,
  /read the brochure carefully/i,
  /all rights reserved/i,
  /for any further usage/i,
  /for more details.*see/i,
  /admissions\.bits-pilani\.ac\.in/i,
  /^page\s+\d+/i,
  /^\d+\s*\|\s*p\s*a\s*g\s*e/i,
  /^table\s+\d+/i,
  /^section\s*:/i,
  /^part\s+subject\s+no\s+of\s+questions/i,
];

function isBoilerplate(text: string): boolean {
  for (const p of BOILERPLATE_PATTERNS) {
    if (p.test(text)) return true;
  }
  // If text is mostly numbers or punctuation
  const letters = text.replace(/[^a-zA-Z]/g, '').length;
  if (letters < 15) return true;
  return false;
}

export function isListQuestion(query: string): boolean {
  return /\b(what are|list|which|types|parts|all|documents|rules|eligibility criteria)\b/i.test(query);
}

export function isValidBullet(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.endsWith(':') || trimmed.split(/\s+/).length < 5) return false;

  // Reject if it starts with punctuation or digit fragments (e.g. ,000/- or 10,000/- without label)
  if (/^[,.\/\-]|^\d+[\/,\-]/.test(trimmed)) {
    if (!/^[A-Za-z\s'()-]+:\s*/.test(trimmed)) return false;
  }

  // Alphabetic words count: must have sufficient text
  const words = trimmed.match(/[a-zA-Z]{2,}/g) || [];
  if (words.length < 4) return false;

  // Digit to letter ratio: if above 0.4 without a leading label before colon, reject
  const digits = (trimmed.match(/\d/g) || []).length;
  const letters = (trimmed.match(/[a-zA-Z]/g) || []).length;
  if (letters === 0) return false;
  if (digits / letters > 0.4 && !/^[A-Za-z\s'()-]+:\s*/.test(trimmed)) {
    return false;
  }

  if (isBoilerplate(trimmed)) return false;
  return true;
}

export function isUsefulAnswerText(text: string): boolean {
  const cleaned = cleanText(text).replace(/^[-*•\d.)\s]+/, '').trim();
  return isValidBullet(cleaned) && !cleaned.endsWith(':') && !/^[a-z]/.test(cleaned);
}

/**
 * Extract clean, full sentences from top chunks with exact page tracking.
 * Ensures bullets never start mid-sentence or end mid-word.
 */
export function extractCandidateSentences(
  chunks: ScoredChunk[]
): Array<{
  text: string;
  sourceFile: string;
  page: number;
  orderKey: number;
}> {
  const candidates: Array<{
    text: string;
    sourceFile: string;
    page: number;
    orderKey: number;
  }> = [];

  const seen = new Set<string>();
  let globalOrder = 0;

  for (const chunk of chunks) {
    if (chunk.sentences && chunk.sentences.length > 0) {
      for (let sIdx = 0; sIdx < chunk.sentences.length; sIdx++) {
        const item = chunk.sentences[sIdx];
        let cleaned = cleanText(item.text).replace(/^[-*•\d.)\s]+/, '').trim();

        // Fix cut-off: if starting with lowercase or mid-sentence conjunction, skip
        if (/^[a-z]/.test(cleaned) || /^(and|or|but|while|further|which|whereas|including|with|having)\b/i.test(cleaned)) {
          continue;
        }

        // Ensure ending punctuation
        if (!/[.!?]$/.test(cleaned)) {
          cleaned += '.';
        }

        if (cleaned.length >= 25 && cleaned.length <= 260 && isValidBullet(cleaned)) {
          const norm = cleaned.toLowerCase();
          if (!seen.has(norm)) {
            seen.add(norm);
            candidates.push({
              text: cleaned,
              sourceFile: chunk.sourceFile,
              page: item.page,
              orderKey: globalOrder++,
            });
          }
        }
      }
    } else {
      const rawSentences = cleanText(chunk.text).split(/(?<=[.!?])\s+|[•\n\r]+/g);
      for (const raw of rawSentences) {
        let cleaned = cleanText(raw).replace(/^[-*•\d.)\s]+/, '').trim();
        if (/^[a-z]/.test(cleaned) || /^(and|or|but|while|further|which|whereas)\b/i.test(cleaned)) {
          continue;
        }
        if (!/[.!?]$/.test(cleaned)) cleaned += '.';

        if (cleaned.length >= 25 && cleaned.length <= 260 && isValidBullet(cleaned)) {
          const norm = cleaned.toLowerCase();
          if (!seen.has(norm)) {
            seen.add(norm);
            candidates.push({
              text: cleaned,
              sourceFile: chunk.sourceFile,
              page: chunk.pageStart,
              orderKey: globalOrder++,
            });
          }
        }
      }
    }
  }

  return candidates;
}

/**
 * Check if two bullets share >60% words (for de-duplication)
 */
function shareSignificantWords(b1: string, b2: string): boolean {
  const words1 = new Set(b1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(b2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (words1.size === 0 || words2.size === 0) return false;

  let common = 0;
  for (const w of words1) {
    if (words2.has(w)) common++;
  }

  const overlap1 = common / words1.size;
  const overlap2 = common / words2.size;
  return overlap1 > 0.60 || overlap2 > 0.60;
}

/**
 * Score candidate sentences using hybrid formula:
 * dot product + keyword boost, penalizing boilerplate,
 * requiring at least one query/synonym match unless dot > 0.75,
 * de-duplicating similar bullets, and ordering according to query intent.
 */
export function scoreAndSelectBullets(
  query: string,
  queryVector: Float32Array,
  candidates: Array<{
    text: string;
    sourceFile: string;
    page: number;
    orderKey: number;
  }>,
  candidateVectors: Float32Array,
  dim: number = 384,
  sentFloor: number = CONFIG.SENT_FLOOR
): BulletItem[] {
  if (candidates.length === 0) return [];

  const queryTokens = tokenizeQuery(query);
  const scoredItems: BulletItem[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const offset = i * dim;

    // Dot product with query vector (cosine similarity)
    let dot = 0;
    for (let d = 0; d < dim; d++) {
      dot += queryVector[d] * candidateVectors[offset + d];
    }

    // Check keyword & synonym match
    const lowerText = cand.text.toLowerCase();
    let matchedWords = 0;
    for (const token of queryTokens) {
      if (lowerText.includes(token)) {
        matchedWords++;
      }
    }

    // Requirement: require at least one non-stopword query term (or synonym) unless dot > 0.75
    if (matchedWords === 0 && dot <= 0.75) {
      continue;
    }

    // Keyword boost: +0.03 per matched word (max 3 -> +0.09)
    const boost = Math.min(matchedWords, CONFIG.MAX_KEYWORD_BOOST_WORDS) * CONFIG.KEYWORD_BOOST;

    // Keyword score normalized (0 to 1)
    const keywordScore = Math.min(matchedWords / Math.max(queryTokens.length, 1), 1);

    // Hybrid sentence score: 0.6 * embedding + 0.4 * keywordScore + boost
    const finalScore = CONFIG.EMBEDDING_WEIGHT * dot + CONFIG.BM25_WEIGHT * keywordScore + boost;

    if (finalScore >= sentFloor) {
      scoredItems.push({
        text: cand.text,
        sourceFile: cand.sourceFile,
        page: cand.page,
        dotScore: dot,
        keywordScore,
        boost,
        finalScore,
        orderKey: cand.orderKey,
      });
    }
  }

  if (scoredItems.length === 0) {
    return [];
  }

  // Sort candidates by finalScore descending
  scoredItems.sort((a, b) => b.finalScore - a.finalScore);

  // De-duplicate: if a candidate has >60% word overlap with an already selected bullet, skip it
  const selected: BulletItem[] = [];
  const maxBullets = isListQuestion(query) ? 3 : 2;

  for (const item of scoredItems) {
    let duplicate = false;
    for (const chosen of selected) {
      if (shareSignificantWords(chosen.text, item.text)) {
        duplicate = true;
        break;
      }
    }

    if (!duplicate) {
      selected.push(item);
      if (selected.length >= maxBullets) break;
    }
  }

  // Ordering:
  // Show highest-scoring bullet first for single-fact questions; use document order for list questions
  if (isListQuestion(query)) {
    selected.sort((a, b) => a.orderKey - b.orderKey);
  } else {
    selected.sort((a, b) => b.finalScore - a.finalScore);
  }

  return selected;
}
