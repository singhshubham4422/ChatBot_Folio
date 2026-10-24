export const QUOTA_LIMITS = { questionChars: 300, evidenceCount: 5, evidenceChars: 6000, excerptChars: 6000, contextMessages: 4, contextChars: 500 } as const;
export function requestQuotaExceeded(count: number, limit: number) { return count > limit; }
export function tokenBudgetExceeded(used: number, reserved: number, limit: number) { return used + reserved > limit; }
export function validateOnlineInput(input: { question: unknown; evidence: unknown; context: unknown }) {
  if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > QUOTA_LIMITS.questionChars) return false;
  if (!Array.isArray(input.evidence) || input.evidence.length > QUOTA_LIMITS.evidenceCount) return false;
  if (input.evidence.some(item => !item || !Number.isInteger(item.page) || item.page < 1 || typeof item.text !== 'string' || item.text.length > QUOTA_LIMITS.excerptChars)) return false;
  if (!Array.isArray(input.context) || input.context.length > QUOTA_LIMITS.contextMessages || input.context.some(item => typeof item !== 'string' || item.length > QUOTA_LIMITS.contextChars)) return false;
  return input.evidence.reduce((sum, item) => sum + item.text.length, 0) <= QUOTA_LIMITS.evidenceChars;
}
