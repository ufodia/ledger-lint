/** Many invoices at once, with duplicate detection across them. */
import {
  lintInvoice,
  STATUS_ORDER,
  type Finding,
  type LintOptions,
  type LintResult,
  type Status,
  type Verdict,
} from './lint.ts';

export interface BatchResult {
  results: LintResult[];
  verdicts: Record<Verdict, number>;
}

export function summarize(findings: Finding[]): { counts: Record<Status, number>; verdict: Verdict } {
  findings.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const counts = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, findings.filter((f) => f.status === s).length]),
  ) as Record<Status, number>;
  return {
    counts,
    verdict: counts.error ? 'does-not-add-up' : counts.warning ? 'check-warnings' : 'adds-up',
  };
}

const compact = (s?: string) => (s ?? '').toUpperCase().replace(/[\s.\-/]/g, '');

export function lintBatch(items: unknown[], options: LintOptions = {}): BatchResult {
  const results = items.map((item) => lintInvoice(item, options));
  const seen = new Map<string, number>();
  results.forEach((r, i) => {
    const inv = r.mapped.invoice;
    const seller = compact(inv.seller.vatId ?? inv.seller.taxId ?? inv.seller.name);
    const keys: [string, string][] = [];
    if (inv.number) keys.push([`n|${seller}|${compact(inv.number)}`, 'the same seller and invoice number']);
    if (inv.total !== undefined && inv.issueDate)
      keys.push([`t|${seller}|${inv.issueDate}|${inv.total}`, 'the same seller, date and total']);
    for (const [key, what] of keys) {
      const first = seen.get(key);
      if (first !== undefined) {
        r.findings.push({
          id: `duplicate-invoice:${i}`,
          rule: 'duplicate-invoice',
          status: 'warning',
          group: 'document',
          title: 'Possible duplicate',
          fields: ['number'],
          message: `Invoice ${i + 1} has ${what} as invoice ${first + 1}.`,
          cause:
            'The same document was submitted twice, or a reminder or copy was extracted as a new invoice. Paying both is a common duplicate-payment error.',
        });
        Object.assign(r, summarize(r.findings));
        break;
      }
    }
    for (const [key] of keys) if (!seen.has(key)) seen.set(key, i);
  });
  const verdicts = { 'adds-up': 0, 'check-warnings': 0, 'does-not-add-up': 0 } as Record<Verdict, number>;
  for (const r of results) verdicts[r.verdict]++;
  return { results, verdicts };
}
