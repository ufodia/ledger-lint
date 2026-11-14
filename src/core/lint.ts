/** Runs every arithmetic, tax, identifier and date check on one extracted invoice. */
import { daysBetween, formatDate, todayIso } from './dates.ts';
import { explain, explainSum, type Context } from './diagnose.ts';
import {
  checkIban,
  checkTurkishTaxId,
  checkVatId,
  formatIban,
  isUuid,
  turkishInvoiceNumber,
  type IdCheck,
} from './ids.ts';
import { mapInvoice, type MapOptions } from './map.ts';
import type { Invoice, Line, Mapped, Party } from './model.ts';
import { decimalsOf, formatAmount, formatRate, minorUnits, near, round, unitOf } from './numbers.ts';
import { checkRate, VAT_RATES } from './rates.ts';

export type Status = 'error' | 'warning' | 'info' | 'pass';
export type Group = 'arithmetic' | 'tax' | 'identifiers' | 'dates' | 'document';
export type Verdict = 'adds-up' | 'check-warnings' | 'does-not-add-up';

export interface Finding {
  /** Stable id, e.g. "line-amount:lines[2].netAmount". */
  id: string;
  rule: string;
  status: Status;
  group: Group;
  title: string;
  /** Canonical fields involved; the first is the one most likely to be wrong. */
  fields: string[];
  message: string;
  expected?: string;
  found?: string;
  /** Likely cause of a mismatch. */
  cause?: string;
  /** A corrected value to propose to the extractor. */
  suggestion?: string;
}

export interface LintOptions extends MapOptions {
  /** Reference date for "in the future" checks (yyyy-mm-dd). Defaults to today. */
  today?: string;
}

export interface LintResult {
  mapped: Mapped;
  findings: Finding[];
  counts: Record<Status, number>;
  verdict: Verdict;
}

export const STATUS_ORDER: Status[] = ['error', 'warning', 'info', 'pass'];
const EU = new Set(
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '),
);
const LABEL = { seller: 'Seller', buyer: 'Buyer' } as const;

export function lintInvoice(input: unknown, options: LintOptions = {}): LintResult {
  const mapped = mapInvoice(input, options);
  const inv = mapped.invoice;
  const findings: Finding[] = [];
  const cur = inv.currency;
  const dec = minorUnits(cur);
  const unit = unitOf(cur);
  const money = (v: number | undefined) => formatAmount(v, cur);
  const add = (f: Omit<Finding, 'id'>) =>
    findings.push({ ...f, id: `${f.rule}:${f.fields[0] ?? findings.length}` });
  const today = options.today ?? todayIso();
  const country = inv.seller.country;
  const allRates = [
    ...new Set(
      [...inv.lines.map((l) => l.vatRate), ...inv.taxes.map((t) => t.rate), inv.vatRate].filter(
        (r): r is number => r !== undefined,
      ),
    ),
  ];

  // ——— Mapping notes ———
  for (const note of mapped.notes)
    add({
      rule: 'reading',
      status: note.level,
      group: 'document',
      title: `Reading ${fieldLabel(note.field)}`,
      fields: [note.field],
      message: note.message,
    });
  if (mapped.unused.length)
    add({
      rule: 'unused-fields',
      status: 'info',
      group: 'document',
      title: 'Fields not used',
      fields: [],
      message: `${mapped.unused.length} input field(s) were not mapped: ${mapped.unused.slice(0, 8).join(', ')}${mapped.unused.length > 8 ? ', …' : ''}.`,
    });

  // ——— Document ———
  if (!inv.number)
    add({
      rule: 'invoice-number',
      status: 'warning',
      group: 'document',
      title: 'Invoice number',
      fields: ['number'],
      message: 'No invoice number was extracted.',
    });
  if (!cur)
    add({
      rule: 'currency',
      status: 'warning',
      group: 'document',
      title: 'Currency',
      fields: ['currency'],
      message: 'No ISO currency code; amounts are checked with 2 decimals.',
    });
  const precisionFields: [string, number | undefined][] = [
    ['subtotal', inv.subtotal],
    ['vatTotal', inv.vatTotal],
    ['total', inv.total],
    ['amountDue', inv.amountDue],
    ...inv.lines.map((l, i) => [`lines[${i}].netAmount`, l.netAmount] as [string, number | undefined]),
  ];
  for (const [field, value] of precisionFields)
    if (value !== undefined && decimalsOf(value) > dec)
      add({
        rule: 'precision',
        status: 'warning',
        group: 'document',
        title: `${fieldLabel(field)} precision`,
        fields: [field],
        found: String(value),
        message: `${value} has ${decimalsOf(value)} decimals; ${cur ?? 'the currency'} has ${dec}.`,
        cause:
          decimalsOf(value) === 3
            ? 'Three decimals usually mean a thousands separator was read as a decimal point.'
            : undefined,
      });

  // ——— Lines ———
  const nets: (number | undefined)[] = [];
  const seen = new Map<string, number>();
  inv.lines.forEach((line, i) => {
    const f = (name: keyof Line) => `lines[${i}].${name}`;
    const n = i + 1;
    const { quantity: q, unitPrice: p, netAmount: a } = line;
    const d = line.discount ?? 0;
    let net = a;
    if (q !== undefined && p !== undefined) {
      const expected = round(q * p - d, dec);
      if (a === undefined) {
        net = expected;
        add({
          rule: 'line-amount',
          status: 'info',
          group: 'arithmetic',
          title: `Line ${n}: amount`,
          fields: [f('netAmount')],
          expected: money(expected),
          message: `No line amount was extracted; ${money(q)} × ${money(p)} = ${money(expected)} is used.`,
        });
      } else {
        const step = 10 ** -Math.max(decimalsOf(p), dec);
        const tol = unit / 2 + (Math.abs(q) * step) / 2;
        if (near(a, expected, tol) || near(a, q * p - d, tol))
          add({
            rule: 'line-amount',
            status: 'pass',
            group: 'arithmetic',
            title: `Line ${n}: quantity × unit price`,
            fields: [f('netAmount'), f('quantity'), f('unitPrice')],
            message: `${fmtQty(q)} × ${money(p)}${d ? ` − ${money(d)}` : ''} = ${money(a)}`,
          });
        else {
          const ctx: Context = { rates: allRates, others: [{ label: 'unit price', value: p }] };
          let cause = explain(expected, a, dec, ctx);
          let fields = [f('netAmount'), f('quantity'), f('unitPrice')];
          let suggestion = money(expected);
          if (!cause && q !== 0) {
            const implied = (a + d) / q;
            const c = explain(implied, p, Math.max(decimalsOf(p), dec));
            if (c && Number.isFinite(implied)) {
              cause = `The unit price looks wrong. ${c}`;
              fields = [f('unitPrice'), f('netAmount'), f('quantity')];
              suggestion = money(round(implied, Math.max(decimalsOf(p), dec)));
            }
          }
          if (!cause && p !== 0) {
            const implied = (a + d) / p;
            if (Number.isFinite(implied) && near(implied, Math.round(implied), 1e-6)) {
              const c = explain(Math.round(implied), q, 0);
              if (c) {
                cause = `The quantity looks wrong. ${c}`;
                fields = [f('quantity'), f('netAmount'), f('unitPrice')];
                suggestion = fmtQty(Math.round(implied));
              }
            }
          }
          add({
            rule: 'line-amount',
            status: 'error',
            group: 'arithmetic',
            title: `Line ${n}: quantity × unit price`,
            fields,
            expected: money(expected),
            found: money(a),
            message: `${fmtQty(q)} × ${money(p)}${d ? ` − ${money(d)}` : ''} = ${money(expected)}, but the line amount is ${money(a)}.`,
            cause,
            suggestion,
          });
        }
      }
    } else if (a === undefined)
      add({
        rule: 'line-amount',
        status: 'warning',
        group: 'arithmetic',
        title: `Line ${n}: amount`,
        fields: [f('netAmount')],
        message: `Line ${n}${line.description ? ` (“${line.description}”)` : ''} has no amount and no quantity × price.`,
      });
    nets.push(net);

    // Line VAT.
    if (net !== undefined && line.vatRate !== undefined && line.vatAmount !== undefined) {
      const expected = inv.pricesIncludeVat
        ? round(net - net / (1 + line.vatRate / 100), dec)
        : round((net * line.vatRate) / 100, dec);
      if (near(line.vatAmount, expected, unit))
        add({
          rule: 'line-vat',
          status: 'pass',
          group: 'tax',
          title: `Line ${n}: VAT`,
          fields: [f('vatAmount')],
          message: `${formatRate(line.vatRate)} of ${money(net)} = ${money(line.vatAmount)}`,
        });
      else
        add({
          rule: 'line-vat',
          status: 'error',
          group: 'tax',
          title: `Line ${n}: VAT`,
          fields: [f('vatAmount'), f('vatRate'), f('netAmount')],
          expected: money(expected),
          found: money(line.vatAmount),
          message: `${formatRate(line.vatRate)} of ${money(net)} is ${money(expected)}, but the line VAT is ${money(line.vatAmount)}.`,
          cause:
            explain(expected, line.vatAmount, dec, { others: [{ label: 'line amount', value: net }] }) ??
            impliedRate(line.vatAmount, net, country, inv.issueDate),
          suggestion: money(expected),
        });
    }
    if (net !== undefined && line.grossAmount !== undefined && !inv.pricesIncludeVat) {
      const vat =
        line.vatAmount ?? (line.vatRate !== undefined ? round((net * line.vatRate) / 100, dec) : undefined);
      if (vat !== undefined) {
        const expected = round(net + vat, dec);
        if (near(line.grossAmount, expected, unit))
          add({
            rule: 'line-gross',
            status: 'pass',
            group: 'arithmetic',
            title: `Line ${n}: gross`,
            fields: [f('grossAmount')],
            message: `${money(net)} + ${money(vat)} = ${money(line.grossAmount)}`,
          });
        else
          add({
            rule: 'line-gross',
            status: 'error',
            group: 'arithmetic',
            title: `Line ${n}: gross`,
            fields: [f('grossAmount'), f('netAmount'), f('vatAmount')],
            expected: money(expected),
            found: money(line.grossAmount),
            message: `Net ${money(net)} + VAT ${money(vat)} = ${money(expected)}, but the gross amount is ${money(line.grossAmount)}.`,
            cause: explain(expected, line.grossAmount, dec, {
              others: [{ label: 'net amount', value: net }],
            }),
            suggestion: money(expected),
          });
      }
    }

    // Duplicates (a classic of multi-page extraction).
    const key = JSON.stringify([line.description?.toLowerCase(), q, p, a]);
    if ((line.description || a !== undefined) && seen.has(key))
      add({
        rule: 'line-duplicate',
        status: 'warning',
        group: 'arithmetic',
        title: `Line ${n}: duplicate`,
        fields: [f('description')],
        message: `Line ${n} is identical to line ${seen.get(key)! + 1}.`,
        cause:
          'Extractors often repeat a line that appears at a page break or in a carried-forward subtotal.',
      });
    else seen.set(key, i);
  });

  // ——— Subtotal ———
  // `fixed` replaces line amounts already reported as wrong by their expected value, so that one
  // misread line is reported once and not again in every total that depends on it.
  const fixed = nets.map((v, i) => {
    const err = findings.find(
      (x) => x.rule === 'line-amount' && x.status === 'error' && x.fields[0] === `lines[${i}].netAmount`,
    );
    const l = inv.lines[i];
    return err && l.quantity !== undefined && l.unitPrice !== undefined
      ? round(l.quantity * l.unitPrice - (l.discount ?? 0), dec)
      : v;
  });
  const known = nets.every((x) => x !== undefined) && nets.length > 0;
  const linesSum = known
    ? round(
        (nets as number[]).reduce((s, x) => s + x, 0),
        dec + 2,
      )
    : undefined;
  const fixedSum = known
    ? round(
        (fixed as number[]).reduce((s, x) => s + x, 0),
        dec + 2,
      )
    : undefined;
  const correctedLines = fixed.map((v, i) => (v !== nets[i] ? i + 1 : 0)).filter(Boolean);
  const parts = nets.map((v, i) => ({ label: `line ${i + 1} (${money(v)})`, value: v ?? 0 }));
  /** Adds a pass, a rounding warning or an error; returns true unless it is an error. */
  const tiered = (
    rule: string,
    group: Group,
    title: string,
    fields: string[],
    expected: number,
    found: number,
    roundingParts: number,
    message: (e: string, f: string) => string,
    ctx: Context = {},
    extraCause?: string,
  ) => {
    if (near(found, expected, unit / 2)) {
      add({
        rule,
        status: 'pass',
        group,
        title,
        fields,
        message: message(money(expected), money(found)).replace(/, but .*$/, ''),
      });
      return true;
    }
    const roundingOnly = near(found, expected, Math.max(unit, (roundingParts * unit) / 2));
    add({
      rule,
      status: roundingOnly ? 'warning' : 'error',
      group,
      title,
      fields,
      expected: money(expected),
      found: money(found),
      message: message(money(expected), money(found)),
      cause: roundingOnly
        ? `The difference (${money(round(found - expected, dec))}) is within line-by-line rounding; check how the invoice rounds.`
        : (extraCause ?? explain(expected, found, dec, ctx)),
      suggestion: roundingOnly ? undefined : money(round(expected, dec)),
    });
    return roundingOnly;
  };
  const consistent = (rule: string, group: Group, title: string, field: string, what: string) =>
    add({
      rule,
      status: 'info',
      group,
      title,
      fields: [field],
      message: `The ${fieldLabel(field)} is consistent once ${what} is corrected; the error is reported there.`,
    });
  const lineList = (n: number[]) => (n.length === 1 ? `line ${n[0]}` : `lines ${n.join(', ')}`);

  const docAdjust = (inv.charges ?? 0) - (inv.allowances ?? 0);
  let subtotalOk = inv.subtotal !== undefined && linesSum === undefined;
  if (linesSum !== undefined && fixedSum !== undefined && !inv.pricesIncludeVat) {
    if (inv.subtotal === undefined)
      add({
        rule: 'subtotal',
        status: 'info',
        group: 'arithmetic',
        title: 'Subtotal',
        fields: ['subtotal'],
        expected: money(fixedSum),
        message: `No subtotal was extracted; the lines add up to ${money(fixedSum)}.`,
      });
    else if (docAdjust && near(inv.subtotal, linesSum + docAdjust, unit)) {
      subtotalOk = true;
      add({
        rule: 'subtotal',
        status: 'pass',
        group: 'arithmetic',
        title: 'Subtotal = sum of lines',
        fields: ['subtotal'],
        message: `${money(linesSum)} ${docAdjust < 0 ? '−' : '+'} ${money(Math.abs(docAdjust))} = ${money(inv.subtotal)}`,
      });
    } else if (
      !near(inv.subtotal, linesSum, unit) &&
      correctedLines.length &&
      (near(inv.subtotal, fixedSum, unit) || near(inv.subtotal, fixedSum + docAdjust, unit))
    ) {
      subtotalOk = true;
      consistent('subtotal', 'arithmetic', 'Subtotal = sum of lines', 'subtotal', lineList(correctedLines));
    } else
      subtotalOk = tiered(
        'subtotal',
        'arithmetic',
        'Subtotal = sum of lines',
        ['subtotal', ...nets.map((_, i) => `lines[${i}].netAmount`)],
        linesSum,
        inv.subtotal,
        nets.length,
        (e, f) => `The ${nets.length} line amounts add up to ${e}, but the subtotal is ${f}.`,
        { rates: allRates, others: [{ label: 'total', value: inv.total ?? 0 }] },
        explainSum(parts, inv.subtotal, unit),
      );
  }

  // ——— VAT ———
  const net = subtotalOk && inv.subtotal !== undefined ? inv.subtotal : (fixedSum ?? inv.subtotal);
  const bases = net === undefined ? [] : [...new Set([net, round(net + docAdjust, dec)])];
  let expectedVat: number | undefined;
  let vatHow = '';
  let vatCause: string | undefined;
  let vatFix: { lines: number[]; from: number; to: number } | undefined;
  if (inv.taxes.length) {
    inv.taxes.forEach((t, i) => {
      if (t.rate === undefined) return;
      const rate = t.rate;
      const lineBase =
        inv.lines.some((l) => l.vatRate !== undefined) && known
          ? round(
              inv.lines.reduce((s, l, j) => (l.vatRate === rate ? s + (fixed[j] ?? 0) : s), 0),
              dec,
            )
          : undefined;
      if (t.base !== undefined && lineBase !== undefined)
        tiered(
          'tax-base',
          'tax',
          `VAT ${formatRate(rate)}: base`,
          [`taxes[${i}].base`],
          lineBase,
          t.base,
          inv.lines.length,
          (e, f) => `Lines at ${formatRate(rate)} add up to ${e}, but the taxable base is ${f}.`,
        );
      if (t.base !== undefined && t.amount !== undefined) {
        const base = t.base;
        tiered(
          'tax-amount',
          'tax',
          `VAT ${formatRate(rate)}: base × rate`,
          [`taxes[${i}].amount`, `taxes[${i}].base`, `taxes[${i}].rate`],
          round((base * rate) / 100, dec),
          t.amount,
          1,
          (x, y) => `${formatRate(rate)} of ${money(base)} is ${x}, but the VAT shown is ${y}.`,
          { others: [{ label: 'taxable base', value: base }] },
        );
      }
    });
    if (inv.taxes.every((t) => t.amount !== undefined)) {
      expectedVat = round(
        inv.taxes.reduce((s, t) => s + (t.amount ?? 0), 0),
        dec,
      );
      vatHow = 'The VAT breakdown adds up to';
    }
  } else if (
    known &&
    inv.lines.length &&
    inv.lines.every((l) => l.vatRate !== undefined) &&
    !inv.pricesIncludeVat
  ) {
    const byRate = new Map<number, number>();
    inv.lines.forEach((l, j) => byRate.set(l.vatRate!, (byRate.get(l.vatRate!) ?? 0) + (fixed[j] ?? 0)));
    const vatOf = (m: Map<number, number>) =>
      round(
        [...m].reduce((s, [r, b]) => s + round((b * r) / 100, dec), 0),
        dec,
      );
    expectedVat = vatOf(byRate);
    vatHow = [...byRate].map(([r, b]) => `${formatRate(r)} of ${money(round(b, dec))}`).join(' + ') + ' =';
    // Would a rate that is actually in force explain the printed VAT?
    if (inv.vatTotal !== undefined && !near(inv.vatTotal, expectedVat, unit))
      for (const [r, b] of byRate) {
        const check = checkRate(country, r, inv.issueDate);
        if (!check || check.known || vatCause) continue;
        for (const alt of check.inForce) {
          const m = new Map(byRate);
          m.delete(r);
          m.set(alt, (m.get(alt) ?? 0) + b);
          if (near(vatOf(m), inv.vatTotal, unit)) {
            const which = inv.lines.map((l, j) => (l.vatRate === r ? j + 1 : 0)).filter(Boolean);
            vatCause = `The printed VAT matches if ${lineList(which)} is taxed at ${formatRate(alt)} instead of ${formatRate(r)}: the line rate was misread or filled in from an outdated table.`;
            vatFix = { lines: which, from: r, to: alt };
            break;
          }
        }
      }
  } else if (inv.vatRate !== undefined && bases.length && !inv.pricesIncludeVat) {
    const rate = inv.vatRate;
    const candidates = bases.map((b) => round((b * rate) / 100, dec));
    expectedVat =
      candidates.find((c) => inv.vatTotal !== undefined && near(c, inv.vatTotal, unit)) ??
      candidates[candidates.length - 1];
    vatHow = `${formatRate(rate)} of ${money(bases[candidates.indexOf(expectedVat)] ?? bases[0])} =`;
  }
  let vatOk = true;
  if (inv.vatTotal !== undefined && expectedVat !== undefined && vatFix)
    add({
      rule: 'vat-total',
      status: 'error',
      group: 'tax',
      title: 'VAT total vs line rates',
      fields: [...vatFix.lines.map((n) => `lines[${n - 1}].vatRate`), 'vatTotal'],
      expected: formatRate(vatFix.to),
      found: formatRate(vatFix.from),
      message: `${vatHow} ${money(expectedVat)}, but the VAT total is ${money(inv.vatTotal)}.`,
      cause: vatCause,
      suggestion: formatRate(vatFix.to),
    });
  else if (inv.vatTotal !== undefined && expectedVat !== undefined)
    vatOk = tiered(
      'vat-total',
      'tax',
      'VAT total',
      ['vatTotal'],
      expectedVat,
      inv.vatTotal,
      inv.lines.length || 1,
      (e, f) => `${vatHow} ${e}, but the VAT total is ${f}.`,
      { rates: allRates, others: [{ label: 'subtotal', value: inv.subtotal ?? 0 }] },
      vatCause,
    );
  else if (
    inv.vatTotal !== undefined &&
    expectedVat === undefined &&
    bases.length &&
    bases[0] !== 0 &&
    !inv.pricesIncludeVat
  ) {
    const implied = round((inv.vatTotal / bases[0]) * 100, 2);
    const check = checkRate(country, implied, inv.issueDate);
    const close =
      country !== undefined && (VAT_RATES[country]?.some((r) => Math.abs(r.rate - implied) < 0.05) ?? false);
    add({
      rule: 'vat-total',
      status: close || !check ? 'info' : 'warning',
      group: 'tax',
      title: 'VAT total',
      fields: ['vatTotal'],
      message:
        close || !check
          ? `No rate was extracted; the VAT total implies ${formatRate(implied)}.`
          : `The VAT total implies ${formatRate(implied)}, which is not a VAT rate in ${country}${check.inForce.length ? ` (${check.inForce.map(formatRate).join(', ')})` : ''}.`,
      cause:
        close || !check
          ? undefined
          : 'Either the VAT total or the subtotal is misread, or several rates apply and the breakdown was not extracted.',
    });
  }
  // When the VAT total itself is wrong but the rates are fine, the printed total should use the expected VAT.
  const vatForTotal = !vatOk && expectedVat !== undefined && !vatCause ? expectedVat : inv.vatTotal;

  // ——— Total ———
  if (inv.total !== undefined) {
    const total = inv.total;
    if (inv.pricesIncludeVat && linesSum !== undefined && fixedSum !== undefined) {
      if (
        !near(total, linesSum + docAdjust, unit) &&
        correctedLines.length &&
        near(total, fixedSum + docAdjust, unit)
      )
        consistent('total', 'arithmetic', 'Total = sum of lines', 'total', lineList(correctedLines));
      else
        tiered(
          'total',
          'arithmetic',
          'Total = sum of lines (prices include VAT)',
          ['total'],
          round(linesSum + docAdjust, dec),
          total,
          inv.lines.length,
          (e, f) => `The gross line amounts add up to ${e}, but the total is ${f}.`,
          {},
          explainSum(parts, total, unit),
        );
    } else if (inv.vatTotal !== undefined && (inv.subtotal !== undefined || net !== undefined)) {
      const sub = inv.subtotal ?? net!;
      const vat = inv.vatTotal;
      const candidates = [round(sub + vat, dec), round(sub + docAdjust + vat, dec)];
      const match = candidates.find((c) => near(c, total, unit / 2));
      const fixedNet = net ?? sub;
      const fixedCandidates =
        vatForTotal !== undefined
          ? [round(fixedNet + vatForTotal, dec), round(fixedNet + docAdjust + vatForTotal, dec)]
          : [];
      if (match !== undefined)
        add({
          rule: 'total',
          status: 'pass',
          group: 'arithmetic',
          title: 'Total = net + VAT',
          fields: ['total'],
          message: `${money(sub)}${match !== candidates[0] ? ` ${docAdjust < 0 ? '−' : '+'} ${money(Math.abs(docAdjust))}` : ''} + ${money(vat)} = ${money(total)}`,
        });
      else if (fixedCandidates.some((c) => near(c, total, unit / 2)))
        consistent(
          'total',
          'arithmetic',
          'Total = net + VAT',
          'total',
          [vatForTotal !== vat ? 'the VAT total' : '', fixedNet !== sub ? 'the subtotal' : '']
            .filter(Boolean)
            .join(' and ') || 'the lines',
        );
      else {
        const expected = docAdjust
          ? (fixedCandidates[1] ?? candidates[1])
          : (fixedCandidates[0] ?? candidates[0]);
        const cause = near(total, sub, unit)
          ? 'The total equals the net amount: VAT was not added, or the net amount was extracted as the total.'
          : explain(expected, total, dec, {
              rates: allRates,
              others: [
                { label: 'VAT total', value: vat },
                { label: 'amount due', value: inv.amountDue ?? 0 },
              ],
            });
        add({
          rule: 'total',
          status: 'error',
          group: 'arithmetic',
          title: 'Total = net + VAT',
          fields: ['total', 'subtotal', 'vatTotal'],
          expected: money(expected),
          found: money(total),
          message: `${money(fixedNet)}${docAdjust ? ` ${docAdjust < 0 ? '−' : '+'} ${money(Math.abs(docAdjust))}` : ''} + ${money(vatForTotal)} = ${money(expected)}, but the total is ${money(total)}.`,
          cause,
          suggestion: money(expected),
        });
      }
    }
  }

  // ——— Withholding (KDV tevkifatı) ———
  if (inv.withholdingRate !== undefined || inv.withholdingAmount !== undefined) {
    const wr = inv.withholdingRate;
    if (wr !== undefined && !near(wr * 10, Math.round(wr * 10), 1e-6))
      add({
        rule: 'withholding',
        status: 'warning',
        group: 'tax',
        title: 'VAT withholding rate',
        fields: ['withholdingRate'],
        message: `${round(wr * 10, 2)}/10 is not a withholding fraction used in Türkiye (1/10 … 10/10).`,
      });
    if (inv.vatTotal !== undefined) {
      if (wr !== undefined && inv.withholdingAmount !== undefined)
        tiered(
          'withholding',
          'tax',
          'VAT withholding (tevkifat)',
          ['withholdingAmount', 'withholdingRate', 'vatTotal'],
          round(inv.vatTotal * wr, dec),
          inv.withholdingAmount,
          1,
          (e, f) =>
            `${round(wr * 10, 2)}/10 of the VAT (${money(inv.vatTotal)}) is ${e}, but the withheld VAT is ${f}.`,
          { others: [{ label: 'VAT total', value: inv.vatTotal }] },
        );
      else if (inv.withholdingAmount !== undefined && inv.vatTotal) {
        const implied = inv.withholdingAmount / inv.vatTotal;
        const tenth = Math.round(implied * 10);
        add({
          rule: 'withholding',
          status: near(implied * 10, tenth, 0.01) ? 'info' : 'warning',
          group: 'tax',
          title: 'VAT withholding (tevkifat)',
          fields: ['withholdingAmount'],
          message: near(implied * 10, tenth, 0.01)
            ? `The withheld VAT is ${tenth}/10 of the VAT total.`
            : `The withheld VAT is ${round(implied * 100, 1)}% of the VAT, which is not a k/10 fraction.`,
        });
      }
    }
  }

  // ——— Amount due ———
  if (inv.amountDue !== undefined && inv.total !== undefined) {
    const withheld =
      inv.withholdingAmount ??
      (inv.withholdingRate !== undefined && inv.vatTotal !== undefined
        ? round(inv.vatTotal * inv.withholdingRate, dec)
        : 0);
    const expected = round(inv.total - (inv.prepaid ?? 0) - withheld, dec);
    const how = `${money(inv.total)}${inv.prepaid ? ` − prepaid ${money(inv.prepaid)}` : ''}${withheld ? ` − withheld VAT ${money(withheld)}` : ''}`;
    if (near(inv.amountDue, expected, unit / 2))
      add({
        rule: 'amount-due',
        status: 'pass',
        group: 'arithmetic',
        title: 'Amount due',
        fields: ['amountDue'],
        message: `${how} = ${money(inv.amountDue)}`,
      });
    else
      add({
        rule: 'amount-due',
        status: 'error',
        group: 'arithmetic',
        title: 'Amount due',
        fields: ['amountDue', 'total'],
        expected: money(expected),
        found: money(inv.amountDue),
        message: `${how} = ${money(expected)}, but the amount due is ${money(inv.amountDue)}.`,
        cause:
          withheld && near(inv.amountDue, inv.total, unit)
            ? 'The amount due equals the total: the withheld VAT was not deducted.'
            : explain(expected, inv.amountDue, dec, {
                rates: allRates,
                others: [
                  { label: 'subtotal', value: inv.subtotal ?? 0 },
                  { label: 'VAT total', value: inv.vatTotal ?? 0 },
                ],
              }),
        suggestion: money(expected),
      });
  }
  if (inv.total !== undefined && inv.total < 0)
    add({
      rule: 'negative-total',
      status: 'info',
      group: 'document',
      title: 'Negative total',
      fields: ['total'],
      message: 'The total is negative: this should be a credit note.',
    });

  // ——— VAT rates ———
  for (const rate of allRates) {
    const check = checkRate(country, rate, inv.issueDate);
    if (!check) continue;
    if (check.known)
      add({
        rule: 'vat-rate',
        status: 'pass',
        group: 'tax',
        title: `VAT rate ${formatRate(rate)}`,
        fields: ['vatRate'],
        message: `${formatRate(rate)} is a VAT rate in ${country}${inv.issueDate ? ` on ${formatDate(inv.issueDate)}` : ''}.`,
      });
    else
      add({
        rule: 'vat-rate',
        status: 'warning',
        group: 'tax',
        title: `VAT rate ${formatRate(rate)}`,
        fields: ['vatRate'],
        message: check.outOfPeriod
          ? `${formatRate(rate)} applied in ${country} ${check.outOfPeriod.to ? `until ${formatDate(check.outOfPeriod.to)}` : `from ${formatDate(check.outOfPeriod.from)}`}; on ${formatDate(inv.issueDate)} the rates are ${check.inForce.map(formatRate).join(', ')}.`
          : `${formatRate(rate)} is not a VAT rate in ${country} (${check.inForce.map(formatRate).join(', ')}, or 0 %).`,
        cause: check.outOfPeriod
          ? 'An outdated rate: the invoice, the date or the rate was misread, or the template is old.'
          : 'The rate was probably misread, or the seller country is wrong.',
      });
  }
  const buyerCountry = inv.buyer.country;
  if (
    country &&
    buyerCountry &&
    country !== buyerCountry &&
    EU.has(country) &&
    EU.has(buyerCountry) &&
    inv.buyer.vatId &&
    (inv.vatTotal ?? 0) > 0
  )
    add({
      rule: 'reverse-charge',
      status: 'info',
      group: 'tax',
      title: 'Cross-border B2B',
      fields: ['vatTotal'],
      message: `A ${country} seller charges VAT to a ${buyerCountry} business with a VAT ID. Intra-EU B2B supplies are usually reverse-charged; check that VAT is really due.`,
    });

  // ——— Identifiers ———
  const idFinding = (field: string, title: string, res: IdCheck, display = res.value) => {
    const show = (v: string) => (res.kind === 'IBAN' ? formatIban(v) : v);
    if (res.valid)
      add({
        rule: 'identifier',
        status: res.formatOnly ? 'info' : 'pass',
        group: 'identifiers',
        title,
        fields: [field],
        message: `${display}: ${res.formatOnly ? res.reason : `valid ${res.kind}`}`,
      });
    else
      add({
        rule: 'identifier',
        status: 'error',
        group: 'identifiers',
        title,
        fields: [field],
        found: display,
        message: `${display}: ${res.reason}`,
        cause: res.suggestion ? `Probably ${show(res.suggestion.value)}: ${res.suggestion.note}.` : undefined,
        suggestion: res.suggestion ? show(res.suggestion.value) : undefined,
      });
  };
  const ids: Record<string, string> = {};
  for (const role of ['seller', 'buyer'] as const) {
    const party: Party = inv[role];
    if (!party.name && role === 'seller')
      add({
        rule: 'party',
        status: 'warning',
        group: 'identifiers',
        title: 'Seller name',
        fields: ['seller.name'],
        message: 'No seller name was extracted.',
      });
    if (party.vatId) {
      const res = checkVatId(party.vatId, party.country);
      idFinding(`${role}.vatId`, `${LABEL[role]} VAT ID`, res);
      ids[`${role}.vatId`] = res.value;
      const prefix = res.value.slice(0, 2);
      const vatCountry = prefix === 'EL' ? 'GR' : prefix;
      if (
        res.valid &&
        party.country &&
        /^[A-Z]{2}$/.test(vatCountry) &&
        vatCountry !== party.country &&
        !(vatCountry === 'XI' && party.country === 'GB') &&
        res.kind === 'VAT ID'
      )
        add({
          rule: 'vat-country',
          status: 'warning',
          group: 'identifiers',
          title: `${LABEL[role]} VAT ID country`,
          fields: [`${role}.vatId`, `${role}.country`],
          message: `The VAT ID is from ${vatCountry} but the ${role}'s country is ${party.country}.`,
        });
    }
    if (party.taxId) {
      const value = party.taxId.replace(/\s/g, '');
      const turkish = party.country === 'TR' || cur === 'TRY' || /^TR\d/.test(value.toUpperCase());
      let res: IdCheck | undefined;
      if (turkish && /^(TR)?\d{10,11}$/i.test(value)) res = checkTurkishTaxId(value);
      else if (/^[A-Z]{2}/i.test(value)) res = checkVatId(value, party.country);
      else if (party.country && EU.has(party.country) && !party.vatId) res = checkVatId(value, party.country);
      if (res) {
        idFinding(
          `${role}.taxId`,
          `${LABEL[role]} ${res.kind === 'VAT ID' ? 'VAT ID' : `tax number (${res.kind})`}`,
          res,
        );
        ids[`${role}.taxId`] = res.value;
      } else
        add({
          rule: 'identifier',
          status: 'info',
          group: 'identifiers',
          title: `${LABEL[role]} tax number`,
          fields: [`${role}.taxId`],
          message: `${party.taxId}: no check digit is known for this kind of number.`,
        });
    }
    if (party.iban) {
      const res = checkIban(party.iban);
      idFinding(`${role}.iban`, `${LABEL[role]} IBAN`, res, formatIban(res.value));
      ids[`${role}.iban`] = res.value;
    }
  }
  if (inv.iban) {
    const res = checkIban(inv.iban);
    idFinding('iban', 'Payment IBAN', res, formatIban(res.value));
    if (res.valid && country && res.value.slice(0, 2) !== country)
      add({
        rule: 'iban-country',
        status: 'info',
        group: 'identifiers',
        title: 'IBAN country',
        fields: ['iban'],
        message: `The payment account is in ${res.value.slice(0, 2)}, the seller in ${country}.`,
      });
    if (inv.seller.iban && ids['seller.iban'] && res.value !== ids['seller.iban'])
      add({
        rule: 'iban-mismatch',
        status: 'warning',
        group: 'identifiers',
        title: 'Two different IBANs',
        fields: ['iban', 'seller.iban'],
        message:
          'The payment IBAN differs from the seller IBAN. Changed bank details are a common invoice-fraud pattern: confirm with the supplier through a known channel.',
      });
  }
  for (const k of ['vatId', 'taxId', 'iban'])
    if (ids[`seller.${k}`] && ids[`seller.${k}`] === ids[`buyer.${k}`])
      add({
        rule: 'same-party',
        status: 'error',
        group: 'identifiers',
        title: 'Seller and buyer identical',
        fields: [`buyer.${k}`, `seller.${k}`],
        message: `Seller and buyer have the same ${k === 'iban' ? 'IBAN' : 'tax number'}.`,
        cause: 'The extraction probably copied one party into the other.',
      });
  if (inv.uuid) {
    if (isUuid(inv.uuid))
      add({
        rule: 'uuid',
        status: 'pass',
        group: 'identifiers',
        title: country === 'TR' ? 'ETTN' : 'Document UUID',
        fields: ['uuid'],
        message: `${inv.uuid}: valid UUID format`,
      });
    else
      add({
        rule: 'uuid',
        status: 'error',
        group: 'identifiers',
        title: country === 'TR' ? 'ETTN' : 'Document UUID',
        fields: ['uuid'],
        found: inv.uuid,
        message: `${inv.uuid} is not a UUID (8-4-4-4-12 hexadecimal characters).`,
        cause: 'Characters were probably dropped or misread (O for 0, l for 1).',
      });
  }

  // ——— Dates ———
  const issue = inv.issueDate;
  if (!issue && !mapped.notes.some((n) => n.field === 'issueDate'))
    add({
      rule: 'issue-date',
      status: 'warning',
      group: 'dates',
      title: 'Issue date',
      fields: ['issueDate'],
      message: 'No issue date was extracted.',
    });
  if (issue && issue > today)
    add({
      rule: 'issue-date',
      status: 'warning',
      group: 'dates',
      title: 'Issue date in the future',
      fields: ['issueDate'],
      message: `${formatDate(issue)} is after ${formatDate(today)}.`,
      cause: 'Day and month may be swapped, or the year misread.',
    });
  if (issue && inv.dueDate) {
    const days = daysBetween(issue, inv.dueDate);
    if (days < 0)
      add({
        rule: 'due-date',
        status: 'error',
        group: 'dates',
        title: 'Due date before issue date',
        fields: ['dueDate', 'issueDate'],
        message: `Due ${formatDate(inv.dueDate)} is ${-days} day(s) before the issue date ${formatDate(issue)}.`,
        cause: 'The two dates are probably swapped, or day and month were confused.',
      });
    else if (days > 365)
      add({
        rule: 'due-date',
        status: 'warning',
        group: 'dates',
        title: 'Payment term',
        fields: ['dueDate'],
        message: `The due date is ${days} days after the issue date.`,
        cause: 'The year may be misread.',
      });
    else
      add({
        rule: 'due-date',
        status: 'pass',
        group: 'dates',
        title: 'Payment term',
        fields: ['dueDate'],
        message: `Due ${days} day(s) after issue.`,
      });
  }
  if (inv.periodStart && inv.periodEnd && inv.periodStart > inv.periodEnd)
    add({
      rule: 'period',
      status: 'error',
      group: 'dates',
      title: 'Service period',
      fields: ['periodStart', 'periodEnd'],
      message: `The period starts ${formatDate(inv.periodStart)}, after it ends ${formatDate(inv.periodEnd)}.`,
    });
  if (inv.number && issue) {
    const tr = turkishInvoiceNumber(inv.number);
    if (tr && (country === 'TR' || cur === 'TRY')) {
      const year = Number(issue.slice(0, 4));
      if (tr.year !== year)
        add({
          rule: 'number-year',
          status: 'warning',
          group: 'dates',
          title: 'e-Fatura number year',
          fields: ['number', 'issueDate'],
          message: `The invoice number ${inv.number} carries the year ${tr.year}, the issue date ${year}.`,
          cause: 'The number or the date was misread.',
        });
      else
        add({
          rule: 'number-year',
          status: 'pass',
          group: 'dates',
          title: 'e-Fatura number year',
          fields: ['number'],
          message: `${inv.number}: year ${tr.year} matches the issue date.`,
        });
    }
  }

  findings.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const counts = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, findings.filter((f) => f.status === s).length]),
  ) as Record<Status, number>;
  const verdict: Verdict = counts.error ? 'does-not-add-up' : counts.warning ? 'check-warnings' : 'adds-up';
  return { mapped, findings, counts, verdict };
}

function impliedRate(vat: number, net: number, country?: string, date?: string): string | undefined {
  if (!net) return undefined;
  const rate = round((vat / net) * 100, 2);
  const check = checkRate(country, rate, date);
  return check?.known || (!check && [5, 7, 10, 19, 20, 21].includes(rate))
    ? `The VAT matches ${formatRate(rate)} instead: the rate or the amount was misread.`
    : undefined;
}

const fmtQty = (q: number) => q.toLocaleString('en', { maximumFractionDigits: 4 });

const NAMES: Record<string, string> = {
  number: 'invoice number',
  uuid: 'UUID',
  issueDate: 'issue date',
  dueDate: 'due date',
  deliveryDate: 'delivery date',
  periodStart: 'period start',
  periodEnd: 'period end',
  currency: 'currency',
  subtotal: 'subtotal',
  vatTotal: 'VAT total',
  total: 'total',
  amountDue: 'amount due',
  prepaid: 'prepaid amount',
  allowances: 'discount',
  charges: 'charges',
  vatRate: 'VAT rate',
  withholdingRate: 'withholding rate',
  withholdingAmount: 'withheld VAT',
  iban: 'IBAN',
  netAmount: 'amount',
  unitPrice: 'unit price',
  quantity: 'quantity',
  vatAmount: 'VAT',
  grossAmount: 'gross amount',
  discount: 'discount',
  description: 'description',
  base: 'taxable base',
  amount: 'VAT amount',
  rate: 'rate',
  vatId: 'VAT ID',
  taxId: 'tax number',
  name: 'name',
  country: 'country',
};

/** "lines[2].netAmount" → "line 3 amount"; "seller.vatId" → "seller VAT ID". */
export function fieldLabel(field: string): string {
  const line = /^lines\[(\d+)\]\.(\w+)$/.exec(field);
  if (line) return `line ${Number(line[1]) + 1} ${NAMES[line[2]] ?? line[2]}`;
  const tax = /^taxes\[(\d+)\]\.(\w+)$/.exec(field);
  if (tax) return `VAT row ${Number(tax[1]) + 1} ${NAMES[tax[2]] ?? tax[2]}`;
  const party = /^(seller|buyer)\.(\w+)$/.exec(field);
  if (party) return `${party[1]} ${NAMES[party[2]] ?? party[2]}`;
  return NAMES[field] ?? field;
}

export type { Invoice };
