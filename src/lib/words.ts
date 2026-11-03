const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];
const CUR: Record<string, [string, string]> = { GHS: ['Ghana Cedis', 'Pesewas'], USD: ['US Dollars', 'Cents'], EUR: ['Euros', 'Cents'], GBP: ['Pounds Sterling', 'Pence'], NGN: ['Naira', 'Kobo'] };

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)], 'Hundred'); n %= 100; if (n) parts.push('and'); }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')); } else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}
export function integerToWords(n: number): string {
  if (n === 0) return 'Zero';
  const groups: string[] = []; let i = 0; const units = n % 1000; const higher = n >= 1000;
  while (n > 0) { const g = n % 1000; if (g) groups.unshift(below1000(g) + (SCALES[i] ? ' ' + SCALES[i] : '')); n = Math.floor(n / 1000); i++; }
  const out = groups.join(' ');
  return higher && units > 0 && units < 100 ? out.replace(new RegExp(` ${below1000(units)}$`), ` and ${below1000(units)}`) : out;
}
/** 5200.5 GHS -> "Five Thousand Two Hundred Ghana Cedis and Fifty Pesewas Only" */
export function amountInWords(amount: number, currency = 'GHS'): string {
  const total = Math.round(Math.abs(amount) * 100); const major = Math.floor(total / 100); const minor = total % 100;
  const [mj, mn] = CUR[currency] ?? [currency, 'Minor Units'];
  return `${integerToWords(major)} ${mj}${minor ? ` and ${integerToWords(minor)} ${mn}` : ''} Only`;
}
