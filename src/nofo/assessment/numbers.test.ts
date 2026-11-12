import { describe, expect, it } from 'vitest';
import { numberAppears, numbersInText } from './numbers.js';

describe('numbersInText / numberAppears', () => {
  it('reads digits, commas, amounts with a unit, percentages and number words', () => {
    expect(numberAppears('No more than four projects per application.', 4)).toBe(true);
    expect(numberAppears('The award ceiling is $500,000 per award.', 500000)).toBe(true);
    expect(numberAppears('Up to $25 million is available.', 25_000_000)).toBe(true);
    expect(numberAppears('A match of at least 20 percent.', 20)).toBe(true);
    expect(numberAppears('Narratives are limited to 35 pages.', 35)).toBe(true);
    expect(numberAppears('Within twenty days of the award.', 20)).toBe(true);
  });

  it('does not find a number that is not there', () => {
    expect(numberAppears('No more than four projects per application.', 9)).toBe(false);
    expect(numberAppears('', 1)).toBe(false);
    expect(numberAppears('Four projects.', Number.NaN)).toBe(false);
    expect(numbersInText('no figures at all')).toEqual([]);
  });
});
