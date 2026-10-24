import type { TableData } from './types.ts';

export function normalizeTableRows(rows: string[][]): string[][] {
  return rows
    .map(row => row.map(cell => cell.replace(/\s+/g, ' ').trim()).filter(Boolean))
    .filter(row => row.length >= 2)
    .map(row => [row[0], row.slice(1).join(' ')]);
}

export function tableNumbersAreGrounded(table: TableData, sourceText: string): boolean {
  const source = sourceText.replace(/\s+/g, ' ');
  return table.rows.every(row => row.slice(1).every(cell => (cell.match(/\d[\d,./%-]*/g) ?? []).every(number => source.includes(number))));
}
