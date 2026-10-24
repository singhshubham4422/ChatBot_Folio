import { describe, expect, it } from 'vitest';
import { cleanText, isUsefulAnswerText } from './answer';

describe('structured answer quality filters', () => {
  it('rejects heading-only and fragment bullets', () => {
    expect(isUsefulAnswerText('Other Fees (based on options selected):')).toBe(false);
    expect(isUsefulAnswerText('Fees')).toBe(false);
    expect(isUsefulAnswerText('starts mid sentence with a fragment')).toBe(false);
  });

  it('removes punctuation artifacts without changing figures', () => {
    expect(cleanText('Amount:. 12 th.')).toBe('Amount: 12th.');
    expect(cleanText('Total.. 2,25,000')).toBe('Total. 2,25,000');
  });
});
