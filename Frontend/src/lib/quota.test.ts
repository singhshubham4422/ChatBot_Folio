import { describe, expect, it } from 'vitest';
import { requestQuotaExceeded, tokenBudgetExceeded, validateOnlineInput } from './quota';

describe('online request limits', () => {
  it('blocks requests when a per-network or global count goes over the limit', () => {
    expect(requestQuotaExceeded(20, 20)).toBe(false);
    expect(requestQuotaExceeded(21, 20)).toBe(true);
  });
  it('reserves output tokens before spending a daily token budget', () => {
    expect(tokenBudgetExceeded(900, 100, 1000)).toBe(false);
    expect(tokenBudgetExceeded(901, 100, 1000)).toBe(true);
  });
  it('rejects malformed or oversized requests before provider use', () => {
    expect(validateOnlineInput({ question: 'Summarize', evidence: [{ page: 1, text: 'Passage' }], context: [] })).toBe(true);
    expect(validateOnlineInput({ question: '', evidence: [], context: [] })).toBe(false);
    expect(validateOnlineInput({ question: 'Question', evidence: [{ page: 0, text: 'Passage' }], context: [] })).toBe(false);
    expect(validateOnlineInput({ question: 'Question', evidence: Array(6).fill({ page: 1, text: 'Passage' }), context: [] })).toBe(false);
  });
});
