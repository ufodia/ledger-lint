/** Check digits and formats of IBANs, Turkish tax numbers and EU VAT identification numbers. */

export interface IdCheck {
  valid: boolean;
  /** Normalised form: upper case, no spaces or punctuation. */
  value: string;
  /** What kind of identifier was recognised. */
  kind: string;
  /** Why it is invalid, or a remark about a valid one. */
  reason?: string;
  /** True when only the format could be checked (no published check digit). */
  formatOnly?: boolean;
  /** A single correction that makes it valid, e.g. an OCR confusion. */
  suggestion?: { value: string; note: string };
}

const clean = (s: string) => s.toUpperCase().replace(/[\s.\-/]/g, '');

// ——— IBAN (ISO 13616) ———

/** IBAN lengths from the SWIFT IBAN registry. */
export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FK: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MN: 20,
  MR: 27,
  MT: 31,
  MU: 30,
  NI: 28,
  NL: 18,
  NO: 15,
  OM: 23,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  RU: 33,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
  YE: 30,
};

/** Remainder of the IBAN number modulo 97 (1 for a valid IBAN). */
export function ibanRemainder(iban: string): number {
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest;
}

/** Characters that OCR and vision models confuse. */
const LOOKALIKE: Record<string, string[]> = {
  O: ['0'],
  Q: ['0'],
  D: ['0'],
  '0': ['O', '8', '6'],
  I: ['1'],
  L: ['1'],
  '1': ['I', '7', 'L'],
  '7': ['1'],
  Z: ['2'],
  '2': ['Z', '7'],
  S: ['5'],
  '5': ['S', '6', '3'],
  B: ['8'],
  '8': ['B', '3', '0', '6'],
  '3': ['8', '5'],
  G: ['6'],
  '6': ['G', '8', '5', '0'],
  T: ['7'],
  '9': ['4', '0'],
  '4': ['9'],
};

export function checkIban(input: string): IdCheck {
  const value = clean(input);
  const kind = 'IBAN';
  if (!/^[A-Z]{2}[0-9A-Z]{2}[0-9A-Z]+$/.test(value))
    return {
      valid: false,
      value,
      kind,
      reason: 'An IBAN starts with a two-letter country code and contains only letters and digits.',
      ...ibanFix(value),
    };
  const country = value.slice(0, 2);
  const length = IBAN_LENGTHS[country];
  if (!length) return { valid: false, value, kind, reason: `${country} is not an IBAN country code.` };
  if (value.length !== length)
    return {
      valid: false,
      value,
      kind,
      reason: `A ${country} IBAN has ${length} characters; this one has ${value.length}.`,
    };
  if (ibanRemainder(value) !== 1)
    return {
      valid: false,
      value,
      kind,
      reason: 'The check digits do not match (ISO 13616 mod 97).',
      ...ibanFix(value),
    };
  return { valid: true, value, kind };
}

/** Looks for exactly one lookalike substitution or adjacent swap that yields a valid IBAN. */
function ibanFix(value: string): Pick<IdCheck, 'suggestion'> {
  const found = new Map<string, string>();
  const valid = (s: string) =>
    /^[A-Z]{2}\d{2}[0-9A-Z]+$/.test(s) && IBAN_LENGTHS[s.slice(0, 2)] === s.length && ibanRemainder(s) === 1;
  for (let i = 2; i < value.length; i++) {
    for (const alt of LOOKALIKE[value[i]] ?? []) {
      const candidate = value.slice(0, i) + alt + value.slice(i + 1);
      if (valid(candidate))
        found.set(candidate, `character ${i + 1} looks like "${value[i]}" but is probably "${alt}"`);
    }
  }
  for (let i = 2; i < value.length - 1; i++) {
    if (value[i] === value[i + 1]) continue;
    const candidate = value.slice(0, i) + value[i + 1] + value[i] + value.slice(i + 2);
    if (valid(candidate)) found.set(candidate, `characters ${i + 1} and ${i + 2} are probably swapped`);
  }
  if (found.size !== 1) return {};
  const [[v, note]] = found;
  return { suggestion: { value: v, note } };
}

export const formatIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim();

// ——— Türkiye ———

/** Vergi Kimlik Numarası: 10 digits, the last one a check digit. */
export function vknValid(vkn: string): boolean {
  if (!/^\d{10}$/.test(vkn)) return false;
  const d = [...vkn].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (d[i] + 9 - i) % 10;
    let v = (t * 2 ** (9 - i)) % 9;
    if (t !== 0 && v === 0) v = 9;
    sum += v;
  }
  return (10 - (sum % 10)) % 10 === d[9];
}

/** T.C. Kimlik Numarası: 11 digits, not starting with 0, two check digits. */
export function tcknValid(tckn: string): boolean {
  if (!/^[1-9]\d{10}$/.test(tckn)) return false;
  const d = [...tckn].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  if ((((odd * 7 - even) % 10) + 10) % 10 !== d[9]) return false;
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}

/** A Turkish tax identifier: VKN for companies (10 digits) or TCKN for individuals (11 digits). */
export function checkTurkishTaxId(input: string): IdCheck {
  const value = clean(input).replace(/^TR/, '');
  if (/^\d{10}$/.test(value))
    return vknValid(value)
      ? { valid: true, value, kind: 'VKN' }
      : { valid: false, value, kind: 'VKN', reason: 'The VKN check digit does not match.' };
  if (/^\d{11}$/.test(value))
    return tcknValid(value)
      ? { valid: true, value, kind: 'TCKN' }
      : { valid: false, value, kind: 'TCKN', reason: 'The T.C. Kimlik No check digits do not match.' };
  return {
    valid: false,
    value,
    kind: 'VKN/TCKN',
    reason: 'A Turkish tax number has 10 digits (VKN) or 11 digits (TCKN).',
  };
}

// ——— EU VAT identification numbers ———

const VAT_FORMAT: Record<string, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-HJ-NP-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^[1-9]\d{1,9}$/,
  SE: /^\d{10}01$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
  XI: /^(\d{9}|\d{12}|GD[0-4]\d{2}|HA[5-9]\d{2})$/,
  GB: /^(\d{9}|\d{12}|GD[0-4]\d{2}|HA[5-9]\d{2})$/,
  CHE: /^\d{9}(MWST|TVA|IVA)?$/,
  NO: /^\d{9}(MVA)?$/,
};

const digitsOf = (s: string) => [...s].map(Number);
const weighted = (s: string, weights: number[]) => weights.reduce((sum, w, i) => sum + Number(s[i]) * w, 0);

function luhn(s: string): boolean {
  let sum = 0;
  digitsOf(s)
    .reverse()
    .forEach((d, i) => {
      const v = i % 2 ? d * 2 : d;
      sum += v > 9 ? v - 9 : v;
    });
  return sum % 10 === 0;
}

/** Published check-digit algorithms, by country prefix. */
const VAT_CHECK: Record<string, (n: string) => boolean> = {
  AT: (n) => {
    const d = digitsOf(n.slice(1));
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const p = d[i] * (i % 2 ? 2 : 1);
      sum += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
    }
    return (10 - ((sum + 4) % 10)) % 10 === d[7];
  },
  BE: (n) => 97 - (Number(n.slice(0, 8)) % 97) === Number(n.slice(8)),
  DE: (n) => {
    let product = 10;
    for (let i = 0; i < 8; i++) {
      let sum = (Number(n[i]) + product) % 10;
      if (sum === 0) sum = 10;
      product = (2 * sum) % 11;
    }
    const check = 11 - product === 10 ? 0 : 11 - product;
    return check === Number(n[8]);
  },
  DK: (n) => weighted(n, [2, 7, 6, 5, 4, 3, 2, 1]) % 11 === 0,
  FI: (n) => {
    const r = weighted(n, [7, 9, 10, 5, 8, 4, 2]) % 11;
    if (r === 1) return false;
    return (r === 0 ? 0 : 11 - r) === Number(n[7]);
  },
  FR: (n) => (/^\d{2}/.test(n) ? (12 + 3 * (Number(n.slice(2)) % 97)) % 97 === Number(n.slice(0, 2)) : true),
  IT: (n) => luhn(n),
  LU: (n) => Number(n.slice(0, 6)) % 89 === Number(n.slice(6)),
  NL: (n) => {
    const r = weighted(n, [9, 8, 7, 6, 5, 4, 3, 2]) % 11;
    if (r !== 10 && r === Number(n[8])) return true;
    // Numbers issued to sole traders since 2020 use ISO 7064 mod 97 over "NL" + number.
    return mod97Plain(`NL${n}`) === 1;
  },
  PL: (n) => {
    const r = weighted(n, [6, 5, 7, 2, 3, 4, 5, 6, 7]) % 11;
    return r !== 10 && r === Number(n[9]);
  },
  PT: (n) => {
    const r = 11 - (weighted(n, [9, 8, 7, 6, 5, 4, 3, 2]) % 11);
    return (r >= 10 ? 0 : r) === Number(n[8]);
  },
  SE: (n) => luhn(n.slice(0, 10)),
};

function mod97Plain(s: string): number {
  let rest = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest;
}

export const VAT_COUNTRIES = Object.keys(VAT_FORMAT);

/** Checks a VAT identification number. `country` is used when the number has no prefix. */
export function checkVatId(input: string, country?: string): IdCheck {
  let value = clean(input);
  const kind = 'VAT ID';
  if (/^TR\d{10,11}$/.test(value) || (country === 'TR' && /^\d{10,11}$/.test(value)))
    return checkTurkishTaxId(value);
  let prefix = /^CHE/.test(value) ? 'CHE' : value.slice(0, 2);
  if (!/^[A-Z]{2,3}$/.test(prefix) || !(prefix in VAT_FORMAT || prefix === 'GR')) {
    if (country && /^[\dA-Z]/.test(value)) {
      const assumed = country === 'GR' ? 'EL' : country === 'CH' ? 'CHE' : country;
      if (assumed in VAT_FORMAT) {
        value = assumed + value;
        prefix = assumed;
      }
    }
  }
  if (prefix === 'GR')
    return {
      valid: false,
      value,
      kind,
      reason: 'Greek VAT numbers use the prefix EL, not GR.',
      suggestion: { value: 'EL' + value.slice(2), note: 'Greece uses the prefix EL in VAT numbers' },
    };
  const format = VAT_FORMAT[prefix];
  if (!format)
    return {
      valid: false,
      value,
      kind,
      reason: 'No recognised country prefix (for example DE, FR, EL, XI).',
    };
  const number = value.slice(prefix.length);
  if (!format.test(number))
    return { valid: false, value, kind, reason: `This is not the format of a ${prefix} VAT number.` };
  const check = VAT_CHECK[prefix];
  if (!check)
    return {
      valid: true,
      value,
      kind,
      formatOnly: true,
      reason: `Format checked; ${prefix} numbers have no check digit that is verified here.`,
    };
  return check(number)
    ? { valid: true, value, kind }
    : { valid: false, value, kind, reason: `The ${prefix} check digit does not match.` };
}

// ——— Other ———

export const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());

/** e-Fatura / e-Arşiv numbers: 3-character prefix, 4-digit year, 9-digit sequence. */
export function turkishInvoiceNumber(s: string): { prefix: string; year: number; sequence: number } | null {
  const m = /^([A-Z0-9]{3})(\d{4})(\d{9})$/.exec(s.trim().toUpperCase());
  return m ? { prefix: m[1], year: Number(m[2]), sequence: Number(m[3]) } : null;
}
