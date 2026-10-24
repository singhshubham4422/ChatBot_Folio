import { describe, expect, it } from 'vitest';
import { normalizeTableRows, tableNumbersAreGrounded } from './tables';

describe('table reconstruction', () => {
  it('keeps row labels and amounts together', () => {
    expect(normalizeTableRows([['Tuition fee', 'Rs.', '2,25,000']])).toEqual([['Tuition fee', 'Rs. 2,25,000']]);
  });

  it('rejects figures that are not present in the source text', () => {
    const table = { heading: 'Fees', columns: ['Item', 'Amount'], rows: [['Tuition fee', '2,25,000']], page: 29 };
    expect(tableNumbersAreGrounded(table, 'Tuition fee is 2,25,000.')).toBe(true);
    expect(tableNumbersAreGrounded(table, 'Tuition fee is 2,00,000.')).toBe(false);
  });
});
