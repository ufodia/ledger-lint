/** Date parsing for invoices written in many conventions. */

export interface ParsedDate {
  /** yyyy-mm-dd */
  iso?: string;
  raw?: string;
  /** Set when day and month could be swapped, e.g. 03/04/2026. */
  ambiguous?: string;
  error?: string;
}

const MONTHS: Record<string, number> = {};
const names: [number, string[]][] = [
  [1, ['jan', 'january', 'januar', 'janvier', 'ocak', 'enero', 'gennaio', 'jänner']],
  [2, ['feb', 'february', 'februar', 'février', 'fevrier', 'şubat', 'subat', 'febrero', 'febbraio']],
  [3, ['mar', 'march', 'märz', 'maerz', 'mars', 'mart', 'marzo']],
  [4, ['apr', 'april', 'avril', 'nisan', 'abril', 'aprile']],
  [5, ['may', 'mai', 'mayıs', 'mayis', 'mayo', 'maggio']],
  [6, ['jun', 'june', 'juni', 'juin', 'haziran', 'junio', 'giugno']],
  [7, ['jul', 'july', 'juli', 'juillet', 'temmuz', 'julio', 'luglio']],
  [8, ['aug', 'august', 'août', 'aout', 'ağustos', 'agustos', 'agosto']],
  [9, ['sep', 'sept', 'september', 'septembre', 'eylül', 'eylul', 'septiembre', 'settembre']],
  [10, ['oct', 'october', 'oktober', 'octobre', 'ekim', 'octubre', 'ottobre', 'okt']],
  [11, ['nov', 'november', 'novembre', 'kasım', 'kasim', 'noviembre']],
  [
    12,
    [
      'dec',
      'december',
      'dezember',
      'décembre',
      'decembre',
      'aralık',
      'aralik',
      'diciembre',
      'dicembre',
      'dez',
    ],
  ],
];
for (const [n, list] of names) for (const name of list) MONTHS[name] = n;

const pad = (n: number) => String(n).padStart(2, '0');

function build(year: number, month: number, day: number, raw: string, ambiguous?: string): ParsedDate {
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return { raw, error: `"${raw}" is not a real calendar date` };
  return { iso: `${year}-${pad(month)}-${pad(day)}`, raw, ambiguous };
}

/**
 * Accepts ISO dates (with or without time), d.m.y, d/m/y and m/d/y (flagged when ambiguous),
 * y/m/d, and written months in English, German, French, Spanish, Italian and Turkish.
 * `order` decides ambiguous slash dates: 'dmy' (default, Europe and Türkiye) or 'mdy'.
 */
export function parseDate(input: unknown, order: 'dmy' | 'mdy' = 'dmy'): ParsedDate {
  if (input === null || input === undefined || input === '') return {};
  if (typeof input !== 'string') return { error: `unexpected ${typeof input} as a date` };
  const raw = input.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(raw);
  if (m) return build(+m[1], +m[2], +m[3], raw);
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(raw);
  if (m) return build(+m[1], +m[2], +m[3], raw);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(raw);
  if (m) return build(+m[3], +m[2], +m[1], raw);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(raw);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    if (a > 12) return build(y, b, a, raw);
    if (b > 12) return build(y, a, b, raw);
    const note =
      a === b ? undefined : `"${raw}" can be ${pad(a)} ${monthName(b)} or ${pad(b)} ${monthName(a)}`;
    return order === 'mdy' ? build(y, a, b, raw, note) : build(y, b, a, raw, note);
  }
  const words = raw.toLowerCase().replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 3) {
    const month = (w: string) => MONTHS[w] ?? MONTHS[w.slice(0, 3)];
    if (/^\d{1,2}$/.test(words[0]) && month(words[1]) && /^\d{4}$/.test(words[2]))
      return build(+words[2], month(words[1]), +words[0], raw);
    if (month(words[0]) && /^\d{1,2}$/.test(words[1]) && /^\d{4}$/.test(words[2]))
      return build(+words[2], month(words[0]), +words[1], raw);
  }
  return { raw, error: `"${raw}" is not a recognised date` };
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (m: number) => SHORT[m - 1] ?? String(m);

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const [y, mo, d] = iso.split('-').map(Number);
  return `${d} ${monthName(mo)} ${y}`;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
