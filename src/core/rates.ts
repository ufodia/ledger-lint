/**
 * VAT rates by country with the dates they apply, for plausibility checks only.
 *
 * Sources: the European Commission's Taxes in Europe Database and national announcements, as
 * compiled in November 2026; Türkiye: Presidential Decree 7346 (rates of 10 and 20 % from
 * 10 July 2023). Rates change: a rate that is not listed produces a warning, never an error,
 * and 0 % (exempt, zero-rated, reverse charge, export) is always accepted.
 */

interface Rate {
  rate: number;
  from?: string;
  /** Last day the rate applied. */
  to?: string;
}

const r = (rate: number, from?: string, to?: string): Rate => ({ rate, from, to });

export const VAT_RATES: Record<string, Rate[]> = {
  AT: [r(20), r(13), r(10), r(4.9, '2026-07-01')],
  BE: [r(21), r(12), r(6)],
  BG: [r(20), r(9)],
  HR: [r(25), r(13), r(5)],
  CY: [r(19), r(9), r(5), r(3)],
  CZ: [r(21), r(15, undefined, '2023-12-31'), r(10, undefined, '2023-12-31'), r(12, '2024-01-01')],
  DK: [r(25)],
  EE: [r(22, undefined, '2025-06-30'), r(24, '2025-07-01'), r(13), r(9)],
  FI: [
    r(24, undefined, '2024-08-31'),
    r(25.5, '2024-09-01'),
    r(14, undefined, '2025-12-31'),
    r(13.5, '2026-01-01'),
    r(10),
  ],
  FR: [r(20), r(10), r(5.5), r(2.1)],
  DE: [r(19), r(7)],
  GR: [r(24), r(13), r(6), r(4)],
  HU: [r(27), r(18), r(5)],
  IE: [r(23), r(13.5), r(9), r(4.8)],
  IT: [r(22), r(10), r(5), r(4)],
  LV: [r(21), r(12), r(5)],
  LT: [r(21), r(12), r(9, undefined, '2025-12-31'), r(5)],
  LU: [r(17), r(14), r(8), r(3)],
  MT: [r(18), r(7), r(5)],
  NL: [r(21), r(9)],
  PL: [r(23), r(8), r(5)],
  PT: [r(23), r(13), r(6)],
  RO: [
    r(19, undefined, '2025-07-31'),
    r(21, '2025-08-01'),
    r(9, undefined, '2025-07-31'),
    r(5, undefined, '2025-07-31'),
    r(11, '2025-08-01'),
  ],
  SK: [
    r(20, undefined, '2024-12-31'),
    r(23, '2025-01-01'),
    r(10, undefined, '2024-12-31'),
    r(19, '2025-01-01'),
    r(5),
  ],
  SI: [r(22), r(9.5), r(5)],
  ES: [r(21), r(10), r(4)],
  SE: [r(25), r(12), r(6)],
  TR: [
    r(18, undefined, '2023-07-09'),
    r(8, undefined, '2023-07-09'),
    r(20, '2023-07-10'),
    r(10, '2023-07-10'),
    r(1),
  ],
  GB: [r(20), r(5)],
  CH: [
    r(8.1, '2024-01-01'),
    r(7.7, undefined, '2023-12-31'),
    r(2.6, '2024-01-01'),
    r(3.8, '2024-01-01'),
    r(2.5, undefined, '2023-12-31'),
    r(3.7, undefined, '2023-12-31'),
  ],
  NO: [r(25), r(15), r(12)],
};

export interface RateCheck {
  known: boolean;
  /** Rates in force for the country on the date. */
  inForce: number[];
  /** When the rate exists but not on that date, e.g. 18 % in Türkiye after 9 July 2023. */
  outOfPeriod?: Rate;
}

export function checkRate(country: string | undefined, rate: number, date?: string): RateCheck | null {
  const table = country ? VAT_RATES[country] : undefined;
  if (!table) return null;
  const on = (x: Rate) => !date || ((!x.from || date >= x.from) && (!x.to || date <= x.to));
  const inForce = table.filter(on).map((x) => x.rate);
  if (rate === 0 || inForce.some((x) => Math.abs(x - rate) < 1e-6)) return { known: true, inForce };
  const outOfPeriod = table.find((x) => Math.abs(x.rate - rate) < 1e-6);
  return { known: false, inForce, outOfPeriod };
}
