import { describe, it, expect } from 'vitest';
import { amountInWords, integerToWords } from '../../src/lib/words';
describe('amount in words', () => {
  it('writes cedis and pesewas', () => {
    expect(amountInWords(5200.5)).toBe('Five Thousand Two Hundred Ghana Cedis and Fifty Pesewas Only');
    expect(amountInWords(1)).toBe('One Ghana Cedis Only');
    expect(amountInWords(0.05)).toBe('Zero Ghana Cedis and Five Pesewas Only');
    expect(amountInWords(120000, 'GHS')).toBe('One Hundred and Twenty Thousand Ghana Cedis Only');
    expect(amountInWords(2500000.99, 'USD')).toBe('Two Million Five Hundred Thousand US Dollars and Ninety-Nine Cents Only');
  });
  it('handles teens, hundreds and zero', () => {
    expect(integerToWords(0)).toBe('Zero'); expect(integerToWords(15)).toBe('Fifteen'); expect(integerToWords(101)).toBe('One Hundred and One'); expect(integerToWords(1001)).toBe('One Thousand and One');
    expect(integerToWords(1000000000)).toBe('One Billion');
  });
});
