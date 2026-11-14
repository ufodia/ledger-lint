/**
 * Explains why an extracted number differs from the value the other numbers imply. The patterns
 * are the typical signatures of OCR and vision-model extraction errors.
 */
import { near } from './numbers.ts';

export interface Context {
  /** VAT rates in play, to recognise gross/net confusion. */
  rates?: number[];
  /** Other values on the invoice, to recognise a value copied from the wrong field. */
  others?: { label: string; value: number }[];
}

const OCR_PAIRS = new Set(['17', '38', '56', '68', '08', '06', '09', '49', '58', '27', '14', '35']);
const pair = (a: string, b: string) => OCR_PAIRS.has(a < b ? a + b : b + a);

/** Digits of |value| in minor units, e.g. 1234.5 with 2 decimals → "123450". */
const digits = (value: number, decimals: number) => String(Math.round(Math.abs(value) * 10 ** decimals));

export function explain(
  expected: number,
  found: number,
  decimals: number,
  context: Context = {},
): string | undefined {
  if (!Number.isFinite(expected) || !Number.isFinite(found)) return undefined;
  const unit = 10 ** -decimals;
  if (near(expected, found, unit / 2)) return undefined;
  if (found === 0) return 'The extracted value is 0: the field was probably not read.';
  if (expected !== 0 && near(found, -expected, unit / 2))
    return 'The sign is flipped: a credit, discount or negative amount may have been read as positive or the other way round.';

  if (expected !== 0) {
    const ratio = found / expected;
    for (const k of [-3, 3, -2, 2, -1, 1]) {
      if (Math.abs(ratio / 10 ** k - 1) < 1e-6) {
        const written = expected.toLocaleString('de-DE', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
        if (k === -3)
          return `It is 1,000 times too small: a thousands separator was probably read as a decimal point (“${written}” read as ${found}).`;
        if (k === 3)
          return 'It is 1,000 times too large: a decimal comma was probably read as a thousands separator.';
        if (k === -2) return 'It is 100 times too small: the decimal point is two places too far left.';
        if (k === 2)
          return 'It is 100 times too large: the decimal separator was probably dropped (12,50 read as 1250).';
        return k < 0
          ? 'It is 10 times too small: a digit was lost or the decimal point moved.'
          : 'It is 10 times too large: an extra digit or a misplaced decimal point.';
      }
    }
  }

  const a = digits(expected, decimals);
  const b = digits(found, decimals);
  if (a.length === b.length) {
    const diff = [...a].map((ch, i) => (ch === b[i] ? -1 : i)).filter((i) => i >= 0);
    if (diff.length === 2 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]])
      return diff[1] - diff[0] === 1
        ? `Two adjacent digits are transposed (“${a[diff[0]]}${a[diff[1]]}” read as “${b[diff[0]]}${b[diff[1]]}”).`
        : `Two digits are swapped (${a[diff[0]]} and ${a[diff[1]]}).`;
    if (diff.length === 1) {
      const i = diff[0];
      return `One digit is misread: ${b[i]} instead of ${a[i]}${pair(a[i], b[i]) ? ' — a common OCR confusion' : ''}.`;
    }
  } else if (Math.abs(a.length - b.length) === 1) {
    const [long, short] = a.length > b.length ? [a, b] : [b, a];
    for (let i = 0; i < long.length; i++)
      if (long.slice(0, i) + long.slice(i + 1) === short)
        return a.length > b.length
          ? `A digit is missing (“${long[i]}” was dropped).`
          : `There is an extra digit (“${long[i]}”).`;
  }

  for (const rate of context.rates ?? []) {
    if (!rate) continue;
    const f = 1 + rate / 100;
    const tol = Math.max(unit, Math.abs(expected) * 1e-4);
    if (near(found, expected * f, tol))
      return `It equals the expected value plus ${rate}% VAT: a gross amount was probably taken for a net one.`;
    if (near(found, expected / f, tol))
      return `It equals the expected value without ${rate}% VAT: a net amount was probably taken for a gross one.`;
    if (near(found, (expected * rate) / 100, tol))
      return `It equals ${rate}% of the expected value: the VAT amount was probably taken instead.`;
  }
  for (const other of context.others ?? [])
    if (other.value !== 0 && near(found, other.value, unit / 2))
      return `It equals the ${other.label}: the value was probably copied from the wrong field.`;
  return undefined;
}

/** When a sum is off by exactly one of its parts. */
export function explainSum(
  parts: { label: string; value: number }[],
  found: number,
  unit: number,
): string | undefined {
  const sum = parts.reduce((s, p) => s + p.value, 0);
  const missing = parts.find((p) => p.value !== 0 && near(sum - found, p.value, unit / 2));
  if (missing)
    return `The difference equals ${missing.label}: that line is probably extra, duplicated in the extraction, or left out of the printed total.`;
  const twice = parts.find((p) => p.value !== 0 && near(found - sum, p.value, unit / 2));
  if (twice)
    return `The difference equals ${twice.label}: a line with that amount is probably missing from the extracted items, or counted twice.`;
  return undefined;
}
