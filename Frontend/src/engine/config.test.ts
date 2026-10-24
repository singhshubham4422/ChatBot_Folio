import { describe, expect, it } from 'vitest';
import { detectAnswerMode } from './config';

describe('answer mode detection', () => {
  it('uses detailed mode for list/table topics', () => {
    expect(detectAnswerMode('First Degree semester fees')).toBe('DETAILED');
    expect(detectAnswerMode('BITSAT application dates')).toBe('DETAILED');
    expect(detectAnswerMode('documents required')).toBe('DETAILED');
  });

  it('uses short mode for yes/no and single facts', () => {
    expect(detectAnswerMode('Is there negative marking?')).toBe('SHORT');
    expect(detectAnswerMode('hostel')).toBe('SHORT');
  });
});
