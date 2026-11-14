/** Amount parsing, rounding and comparison helpers. */

/** ISO 4217 minor units that differ from the usual 2. */
const MINOR: Record<string, number> = {
  BHD: 3,
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  IQD: 3,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
};

export const minorUnits = (currency?: string) => MINOR[(currency ?? '').toUpperCase()] ?? 2;
/** The smallest amount of a currency, e.g. 0.01 for EUR. */
export const unitOf = (currency?: string) => 10 ** -minorUnits(currency);

/** Half-up rounding that is not fooled by binary floating point (1.005 → 1.01). */
export function round(value: number, decimals = 2): number {
  const shifted = Number(`${Math.abs(value)}e${decimals}`);
  return Math.sign(value) * Number(`${Math.round(shifted)}e-${decimals}`);
}

export const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance + 1e-9;

/** Number of decimals written in a value, e.g. 12.5 → 1, "12,500" with decimal comma → 3. */
export function decimalsOf(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const text = String(value);
  if (text.includes('e-')) return Number(text.split('e-')[1]);
  return text.split('.')[1]?.length ?? 0;
}

export type DecimalHint = '.' | ',' | undefined;

export interface ParsedAmount {
  value?: number;
  /** The text the value came from, when it was a string. */
  raw?: string;
  /** Set when the separators allowed two readings, e.g. "1.234". */
  ambiguous?: string;
  error?: string;
}

const STRIP = /[\s  '’]|[€$£₺¥₹]|\b(?:EUR|USD|GBP|TRY|TL|CHF|PLN|SEK|DKK|NOK|CZK|HUF|RON|BGN|JPY)\b/gi;

/**
 * Parses a number written by a person or an AI: "1.234,56", "1,234.56", "€ 1 234", "(12.50)",
 * "12.50-". With only one kind of separator followed by exactly three digits ("1.234") the
 * reading depends on the document's convention; `hint` decides and the result is marked ambiguous.
 */
export function parseAmount(input: unknown, hint?: DecimalHint): ParsedAmount {
  if (typeof input === 'number')
    return Number.isFinite(input) ? { value: input } : { error: 'not a finite number' };
  if (typeof input !== 'string')
    return input === null || input === undefined ? {} : { error: `unexpected ${typeof input}` };
  const raw = input.trim();
  if (!raw) return {};
  let text = raw.replace(STRIP, '');
  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }
  if (/^-|-$/.test(text)) {
    sign = -sign;
    text = text.replace(/^-|-$/g, '');
  }
  if (text.startsWith('+')) text = text.slice(1);
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return { raw, error: `"${raw}" is not a number` };

  const dots = (text.match(/\./g) ?? []).length;
  const commas = (text.match(/,/g) ?? []).length;
  let decimal: '.' | ',' | null = null;
  let ambiguous: string | undefined;
  if (dots && commas) decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
  else if (dots + commas === 1) {
    const sep = dots ? '.' : ',';
    const [int, frac] = text.split(sep);
    if (frac.length === 3 && int.length >= 1 && int.length <= 3 && int !== '0') {
      decimal = hint ? (hint === sep ? sep : null) : sep === '.' ? '.' : null;
      ambiguous = `"${raw}" can be read as ${Number(`${int}.${frac}`)} or ${Number(int + frac)}`;
    } else decimal = sep;
  } else if (dots > 1 || commas > 1) decimal = null;

  const thousands = decimal === '.' ? ',' : decimal === ',' ? '.' : dots ? '.' : ',';
  if (decimal) {
    const [int, frac = ''] = text.split(decimal);
    const groups = int.split(thousands);
    if (groups.length > 1 && groups.slice(1).some((g) => g.length !== 3))
      return { raw, error: `"${raw}" has misplaced separators` };
    const value = Number(`${groups.join('')}.${frac}`);
    return { value: sign * value, raw, ambiguous };
  }
  const groups = text.split(thousands);
  if (groups.slice(1).some((g) => g.length !== 3)) return { raw, error: `"${raw}" has misplaced separators` };
  return { value: sign * Number(groups.join('')), raw, ambiguous };
}

/** VAT rates as percentages: 20, "20%", "%20", 0.2 and "0,20" all give 20. */
export function parseRate(input: unknown, hint?: DecimalHint): ParsedAmount {
  if (typeof input === 'string') {
    const t = input.trim();
    const percent = /%/.test(t);
    const parsed = parseAmount(
      t.replace(/%/g, ''),
      hint ?? (t.includes(',') && !t.includes('.') ? ',' : undefined),
    );
    if (parsed.value === undefined) return parsed;
    if (!percent && parsed.value > 0 && parsed.value < 1)
      return { ...parsed, value: round(parsed.value * 100, 6) };
    return parsed;
  }
  const parsed = parseAmount(input);
  if (parsed.value !== undefined && parsed.value > 0 && parsed.value < 1)
    return { value: round(parsed.value * 100, 6) };
  return parsed;
}

/** Turkish VAT withholding written as "5/10", 0.5 or 50 % → 0.5. */
export function parseFraction(input: unknown): number | undefined {
  if (typeof input === 'string') {
    const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(input);
    if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : undefined;
  }
  const rate = parseRate(input).value;
  if (rate === undefined) return undefined;
  return rate > 1 ? rate / 100 : rate;
}

export function formatAmount(value: number | undefined, currency?: string): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const digits = Math.max(minorUnits(currency), Math.min(decimalsOf(value), 4));
  return value.toLocaleString('en', {
    minimumFractionDigits: minorUnits(currency),
    maximumFractionDigits: digits,
  });
}

export const formatRate = (rate: number) => `${round(rate, 4)}%`;
