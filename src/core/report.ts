/** Markdown, CSV and JSON reports, and a correction prompt to hand back to the extractor. */
import { fieldLabel, type Finding, type LintResult, type Verdict } from './lint.ts';
import { formatAmount } from './numbers.ts';

export const TOOL = { name: 'Ledger Lint', version: '1.0.0', url: 'https://github.com/ufodia/ledger-lint' };

export const VERDICT_TEXT: Record<Verdict, string> = {
  'adds-up': 'Adds up — no errors or warnings in the checks performed',
  'check-warnings': 'Check the warnings — no arithmetic contradiction found in the checks performed',
  'does-not-add-up': 'Does not add up — one or more supplied values failed a check',
};

const source = (r: LintResult, f: Finding) => (f.fields[0] ? r.mapped.sources[f.fields[0]] : undefined);
const label = (r: LintResult, i: number) => r.mapped.invoice.number ?? `invoice ${i + 1}`;

export function jsonReport(results: LintResult[], now = new Date()): string {
  return (
    JSON.stringify(
      {
        tool: TOOL,
        generatedAt: now.toISOString(),
        invoices: results.map((r, i) => ({
          index: i + 1,
          number: r.mapped.invoice.number ?? null,
          inputFormat: r.mapped.format,
          decimalSeparator: r.mapped.decimal,
          verdict: r.verdict,
          counts: r.counts,
          invoice: r.mapped.invoice,
          findings: r.findings.map((f) => ({
            status: f.status,
            group: f.group,
            rule: f.rule,
            title: f.title,
            fields: f.fields,
            source: source(r, f) ?? null,
            message: f.message,
            expected: f.expected ?? null,
            found: f.found ?? null,
            cause: f.cause ?? null,
            suggestion: f.suggestion ?? null,
          })),
        })),
      },
      null,
      2,
    ) + '\n'
  );
}

/** Neutralise formula-leading values, including whitespace/control-prefixed cells. */
const csvCell = (v: string) => {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function csvReport(results: LintResult[], includePassed = false): string {
  const rows = [
    [
      'invoice',
      'invoice_number',
      'status',
      'group',
      'rule',
      'title',
      'field',
      'source',
      'expected',
      'found',
      'message',
      'cause',
      'suggestion',
    ],
  ];
  results.forEach((r, i) => {
    for (const f of r.findings)
      if (includePassed || f.status !== 'pass')
        rows.push([
          String(i + 1),
          r.mapped.invoice.number ?? '',
          f.status,
          f.group,
          f.rule,
          f.title,
          f.fields[0] ?? '',
          source(r, f) ?? '',
          f.expected ?? '',
          f.found ?? '',
          f.message,
          f.cause ?? '',
          f.suggestion ?? '',
        ]);
  });
  return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

export function markdownReport(results: LintResult[], now = new Date()): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\\/g, '\\\\')
      .replace(/[\[\]`*_{}()!#]/g, '\\$&')
      .replace(/\|/g, '\\|')
      .replace(/[\r\n]/g, ' ');
  const lines = [
    '# Ledger Lint report',
    '',
    `${results.length} invoice(s) · ${now.toISOString().slice(0, 10)}`,
    '',
  ];
  if (results.length > 1) {
    lines.push(
      '| # | Invoice | Seller | Total | Errors | Warnings | Verdict |',
      '| ---: | --- | --- | ---: | ---: | ---: | --- |',
    );
    results.forEach((r, i) => {
      const inv = r.mapped.invoice;
      lines.push(
        `| ${i + 1} | ${esc(label(r, i))} | ${esc(inv.seller.name ?? '—')} | ${inv.total !== undefined ? esc(`${formatAmount(inv.total, inv.currency)} ${inv.currency ?? ''}`.trim()) : '—'} | ${r.counts.error} | ${r.counts.warning} | ${r.verdict} |`,
      );
    });
    lines.push('');
  }
  results.forEach((r, i) => {
    const inv = r.mapped.invoice;
    lines.push(
      `## ${esc(label(r, i))}${inv.seller.name ? ` · ${esc(inv.seller.name)}` : ''}`,
      '',
      `**Verdict:** ${VERDICT_TEXT[r.verdict]}`,
      '',
    );
    lines.push(
      `${r.counts.error} error(s) · ${r.counts.warning} warning(s) · ${r.counts.pass} check(s) passed`,
      '',
    );
    const issues = r.findings.filter((f) => f.status === 'error' || f.status === 'warning');
    if (issues.length) {
      lines.push(
        '| Status | Check | Field | Detail | Likely cause | Suggested |',
        '| --- | --- | --- | --- | --- | --- |',
      );
      for (const f of issues)
        lines.push(
          `| ${f.status} | ${esc(f.title)} | ${esc(source(r, f) ?? (f.fields[0] ? fieldLabel(f.fields[0]) : ''))} | ${esc(f.message)} | ${esc(f.cause ?? '')} | ${esc(f.suggestion ?? '')} |`,
        );
      lines.push('');
    }
  });
  return lines.join('\n');
}

/** "1,230.00" → "1230.00", so the model writes a JSON number; other suggestions are kept. */
const plain = (s: string) => (/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s);

/**
 * A prompt to paste back into the model that produced the extraction: it names the input fields,
 * what the other values imply and why, and asks for a corrected JSON without inventing values.
 */
export function correctionPrompt(result: LintResult): string {
  const issues = result.findings.filter(
    (f) => (f.status === 'error' || f.status === 'warning') && f.fields.length && f.rule !== 'unused-fields',
  );
  if (!issues.length)
    return 'No corrections are suggested by the checks performed. Confirm the extracted values against the original document.';
  const out = [
    'Some values in the invoice data you extracted are inconsistent with each other. Look at the original document again and check these fields:',
    '',
  ];
  issues.forEach((f, i) => {
    const src = source(result, f);
    const name = src ? `${src.replace(/^\$\.?/, '')} (${fieldLabel(f.fields[0])})` : fieldLabel(f.fields[0]);
    const parts = [`${i + 1}. ${name}: ${f.message}`];
    if (f.cause) parts.push(`Likely cause: ${f.cause}`);
    if (f.suggestion) parts.push(`If the document confirms it, the value should be ${plain(f.suggestion)}.`);
    out.push(parts.join(' '));
  });
  out.push(
    '',
    'Return the complete JSON again in exactly the same structure. Change only values you can confirm on the document. If the document itself contains the inconsistency, keep the printed value and add a short note explaining it. Do not invent values.',
  );
  return out.join('\n');
}
