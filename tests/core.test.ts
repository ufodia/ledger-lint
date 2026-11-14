import { describe, expect, it } from 'vitest';
import { lintBatch } from '../src/core/batch.ts';
import { parseDate } from '../src/core/dates.ts';
import { explain, explainSum } from '../src/core/diagnose.ts';
import { checkIban, checkTurkishTaxId, checkVatId, tcknValid, vknValid } from '../src/core/ids.ts';
import { lintInvoice, type LintResult } from '../src/core/lint.ts';
import { mapInvoice, splitInput } from '../src/core/map.ts';
import { parseAmount, parseFraction, parseRate, round, decimalsOf } from '../src/core/numbers.ts';
import { checkRate } from '../src/core/rates.ts';
import { correctionPrompt, csvReport, jsonReport, markdownReport } from '../src/core/report.ts';
import { azureInvoice, batch, euInvoice, trInvoice } from '../src/demo.ts';

const today = '2026-11-14';
const lint = (input: unknown) => lintInvoice(input, { today });
const problems = (r: LintResult) => r.findings.filter((f) => f.status === 'error' || f.status === 'warning');
const find = (r: LintResult, rule: string, status?: string) =>
  r.findings.find((f) => f.rule === rule && (!status || f.status === status));

describe('numbers', () => {
  it('parses amounts written in either convention', () => {
    expect(parseAmount('1.234,56').value).toBe(1234.56);
    expect(parseAmount('1,234.56').value).toBe(1234.56);
    expect(parseAmount('€ 1 234,50', ',').value).toBe(1234.5);
    expect(parseAmount("1'234.50").value).toBe(1234.5);
    expect(parseAmount('(12.50)').value).toBe(-12.5);
    expect(parseAmount('12.50-').value).toBe(-12.5);
    expect(parseAmount('42,50').value).toBe(42.5);
    expect(parseAmount('TL 18.500,00').value).toBe(18500);
    expect(parseAmount('abc').error).toMatch(/not a number/);
    expect(parseAmount('1.23.4').error).toMatch(/misplaced/);
  });

  it('flags separators that allow two readings and follows the hint', () => {
    expect(parseAmount('1.234', ',')).toMatchObject({ value: 1234, ambiguous: expect.any(String) });
    expect(parseAmount('1.234', '.')).toMatchObject({ value: 1.234, ambiguous: expect.any(String) });
    expect(parseAmount('1,234')).toMatchObject({ value: 1234 });
    expect(parseAmount('0.125').ambiguous).toBeUndefined();
  });

  it('reads rates and withholding fractions', () => {
    expect(parseRate('%20').value).toBe(20);
    expect(parseRate('19%').value).toBe(19);
    expect(parseRate(0.21).value).toBe(21);
    expect(parseRate('0,2').value).toBe(20);
    expect(parseRate(1).value).toBe(1);
    expect(parseFraction('5/10')).toBe(0.5);
    expect(parseFraction(0.2)).toBe(0.2);
    expect(parseFraction('%70')).toBe(0.7);
    expect(parseFraction('1%')).toBe(0.01);
    expect(parseFraction('0.5%')).toBe(0.005);
    expect(parseFraction(1)).toBe(1);
  });

  it('rounds half up despite binary floating point', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(388.626, 2)).toBe(388.63);
    expect(round(-2.675, 2)).toBe(-2.68);
  });

  it('rejects repeated separators instead of silently dropping digits', () => {
    for (const value of ['1,234.56.78', '1.234,56,78', '1234,567.89', ',123.45', '1,234.5,6']) {
      expect(parseAmount(value).error, value).toMatch(/misplaced/);
      expect(parseAmount(value).value, value).toBeUndefined();
    }
    expect(parseAmount('-12-').error).toMatch(/sign/);
    expect(parseAmount('(-12)').error).toMatch(/not a number/);
    expect(parseRate('2%0').error).toMatch(/percent/);
  });

  it('refuses non-finite and unsupported magnitudes', () => {
    expect(parseAmount('9'.repeat(400)).error).toMatch(/finite/);
    expect(parseAmount(Infinity).error).toMatch(/finite/);
    expect(parseAmount(1e20).error).toMatch(/supported numeric range/);
    expect(parseAmount('1000000000001').error).toMatch(/supported numeric range/);
    expect(parseFraction(`${'9'.repeat(400)}/10`)).toBeUndefined();
  });

  it('handles scientific notation when rounding and measuring precision', () => {
    expect(round(1.23e-7, 8)).toBe(1.2e-7);
    expect(round(1e-7, 2)).toBe(0);
    expect(round(-1.25e-7, 8)).toBe(-1.3e-7);
    expect(decimalsOf(1.23e-7)).toBe(9);
    expect(Number.isNaN(round(1e21, 2))).toBe(false);
  });
});

describe('identifiers', () => {
  it('validates IBANs and finds a single OCR fix', () => {
    expect(checkIban('DE89 3704 0044 0532 0130 00').valid).toBe(true);
    expect(checkIban('GB82WEST12345698765432').valid).toBe(true);
    expect(checkIban('TR330006100519786457841326').valid).toBe(true);
    expect(checkIban('DE89 3704 0044 O532 0130 00')).toMatchObject({
      valid: false,
      suggestion: { value: 'DE89370400440532013000' },
    });
    expect(checkIban('DE8937040044053201300').reason).toMatch(/22 characters/);
    expect(checkIban('ZZ12345').reason).toMatch(/not an IBAN country/);
  });

  it('validates Turkish VKN and TCKN check digits', () => {
    expect(vknValid('4540536920')).toBe(true);
    expect(vknValid('4540536921')).toBe(false);
    expect(tcknValid('10000000146')).toBe(true);
    expect(tcknValid('10000000147')).toBe(false);
    expect(tcknValid('00000000146')).toBe(false);
    expect(checkTurkishTaxId('TR 454 053 6920')).toMatchObject({ valid: true, kind: 'VKN' });
    expect(checkTurkishTaxId('12345').reason).toMatch(/10 digits/);
  });

  it('validates EU VAT check digits for twelve countries', () => {
    const valid = [
      'ATU13585627',
      'BE0403019261',
      'DE136695976',
      'DK13585628',
      'FI20774740',
      'FR40303265045',
      'IT00743110157',
      'LU15027442',
      'NL004495445B01',
      'PL8567346215',
      'PT501964843',
      'SE123456789701',
    ];
    for (const id of valid)
      expect([checkVatId(id).valid, checkVatId(id).formatOnly ?? false], id).toEqual([true, false]);
    for (const id of valid) {
      const broken = id.slice(0, 4) + String((Number(id[4]) + 1) % 10) + id.slice(5);
      expect(checkVatId(broken).valid, broken).toBe(false);
    }
  });

  it('checks formats elsewhere, prefixes and the Greek EL rule', () => {
    expect(checkVatId('ESA13585625')).toMatchObject({ valid: true, formatOnly: true });
    expect(checkVatId('136695976', 'DE').valid).toBe(true);
    expect(checkVatId('GR094259216')).toMatchObject({ valid: false, suggestion: { value: 'EL094259216' } });
    expect(checkVatId('DE12345').reason).toMatch(/format/);
    expect(checkVatId('7310045824', 'TR')).toMatchObject({ valid: true, kind: 'VKN' });
  });
});

describe('dates', () => {
  it('parses common invoice date formats', () => {
    expect(parseDate('2026-11-03').iso).toBe('2026-11-03');
    expect(parseDate('2026-11-03T10:00:00Z').iso).toBe('2026-11-03');
    expect(parseDate('03.11.2026').iso).toBe('2026-11-03');
    expect(parseDate('14 Kasım 2026').iso).toBe('2026-11-14');
    expect(parseDate('3. November 2026').iso).toBe('2026-11-03');
    expect(parseDate('Nov 14, 2026').iso).toBe('2026-11-14');
    expect(parseDate('25/12/2026').iso).toBe('2026-12-25');
    expect(parseDate('12/25/2026').iso).toBe('2026-12-25');
  });

  it('flags ambiguous and impossible dates', () => {
    expect(parseDate('04/05/2026')).toMatchObject({
      iso: '2026-05-04',
      ambiguous: expect.stringContaining('04 May'),
    });
    expect(parseDate('04/05/2026', 'mdy').iso).toBe('2026-04-05');
    expect(parseDate('30.02.2026').error).toMatch(/not a real calendar date/);
    expect(parseDate('soon').error).toMatch(/not a recognised date/);
  });
});

describe('VAT rates', () => {
  it('knows when rates changed', () => {
    expect(checkRate('TR', 18, '2023-07-01')?.known).toBe(true);
    expect(checkRate('TR', 18, '2026-10-12')).toMatchObject({
      known: false,
      outOfPeriod: { rate: 18, to: '2023-07-09' },
    });
    expect(checkRate('FI', 25.5, '2024-09-01')?.known).toBe(true);
    expect(checkRate('FI', 25.5, '2024-08-31')?.known).toBe(false);
    expect(checkRate('DE', 0)?.known).toBe(true);
    expect(checkRate('DE', 16)?.known).toBe(false);
    expect(checkRate('US', 8)).toBeNull();
  });
});

describe('diagnosis', () => {
  it('recognises the signatures of extraction errors', () => {
    expect(explain(1230, 1.23, 2)).toMatch(/1,000 times too small/);
    expect(explain(12.5, 1250, 2)).toMatch(/100 times too large/);
    expect(explain(1567.5, 1576.5, 2)).toMatch(/adjacent digits are transposed/);
    expect(explain(13, 18, 0)).toMatch(/8 instead of 3 — a common OCR confusion/);
    expect(explain(1234.5, 134.5, 2)).toMatch(/digit is missing/);
    expect(explain(100, 119, 2, { rates: [19] })).toMatch(/plus 19% VAT/);
    expect(explain(100, 42, 2, { others: [{ label: 'unit price', value: 42 }] })).toMatch(
      /equals the unit price/,
    );
    expect(explain(100, -100, 2)).toMatch(/sign is flipped/);
    expect(explain(100, 100.004, 2)).toBeUndefined();
  });

  it('spots a sum that is off by one line', () => {
    const parts = [
      { label: 'line 1', value: 10 },
      { label: 'line 2', value: 25 },
    ];
    expect(explainSum(parts, 10, 0.01)).toMatch(/line 2/);
    expect(explainSum(parts, 45, 0.01)).toMatch(/line 1/);
  });
});

describe('mapping', () => {
  it('maps LLM JSON with English field names', () => {
    const m = mapInvoice(euInvoice);
    expect(m.format).toBe('generic');
    expect(m.invoice).toMatchObject({
      number: 'RE-2026-0418',
      currency: 'EUR',
      subtotal: 8250,
      vatTotal: 1576.5,
      seller: { name: 'Nordlicht Studio GmbH', country: 'DE' },
    });
    expect(m.invoice.lines).toHaveLength(4);
    expect(m.sources['lines[2].netAmount']).toBe('$.line_items[2].amount');
  });

  it('maps Turkish field names, Turkish number formatting and withholding', () => {
    const m = mapInvoice(trInvoice);
    expect(m.decimal).toBe(',');
    expect(m.invoice).toMatchObject({
      number: 'NLS2026000000137',
      issueDate: '2026-10-12',
      currency: 'TRY',
      subtotal: 73200,
      vatTotal: 14640,
      total: 87840,
      withholdingRate: 0.2,
      withholdingAmount: 2928,
    });
    expect(m.invoice.lines[1]).toMatchObject({
      quantity: 240,
      unitPrice: 42.5,
      netAmount: 10200,
      vatRate: 20,
    });
    expect(m.invoice.seller).toMatchObject({
      name: 'Nilüfer Lojistik A.Ş.',
      taxId: '7310045825',
      country: 'TR',
    });
  });

  it('unwraps Azure Document Intelligence and Google Document AI results', () => {
    const azure = mapInvoice(azureInvoice);
    expect(azure.format).toBe('azure');
    expect(azure.invoice).toMatchObject({
      number: 'INV-88412',
      currency: 'EUR',
      subtotal: 1850.6,
      iban: 'NL20INGB0001234567',
      seller: { taxId: 'NL004495445B01', country: 'NL' },
    });
    expect(azure.invoice.lines[0]).toMatchObject({
      quantity: 4,
      unitPrice: 289,
      netAmount: 1156,
      vatRate: 21,
    });
    const google = mapInvoice(batch[7]);
    expect(google.format).toBe('google');
    expect(google.invoice).toMatchObject({
      number: 'LL-5521',
      issueDate: '2026-10-15',
      currency: 'EUR',
      total: 270.6,
      taxes: [{ rate: 23, amount: 50.6 }],
    });
  });

  it('retains real provider field paths after unwrapping nested values', () => {
    const azure = mapInvoice({ analyzeResult: azureInvoice });
    expect(azure.sources.total).toBe('$.analyzeResult.documents[0].fields.InvoiceTotal.valueCurrency.amount');
    expect(azure.sources['lines[0].netAmount']).toBe(
      '$.analyzeResult.documents[0].fields.Items.valueArray[0].valueObject.Amount.valueCurrency.amount',
    );
    const google = mapInvoice(batch[7]);
    expect(google.sources['lines[0].netAmount']).toBe('$.document.entities[7].properties[3].mentionText');
    expect(google.sources.total).toBe('$.document.entities[11].normalizedValue.moneyValue');
  });

  it('handles flat vendor fields, wrappers, nested totals and unknown fields', () => {
    const m = mapInvoice({
      invoice: {
        InvoiceNo: 'A-1',
        VendorName: 'Acme',
        VendorVatId: 'DE136695976',
        totals: { net: 100, tax: 19, gross: 119, rounding: 0 },
        colour: 'blue',
      },
    });
    expect(m.invoice).toMatchObject({
      number: 'A-1',
      seller: { name: 'Acme', vatId: 'DE136695976', country: 'DE' },
      subtotal: 100,
      vatTotal: 19,
      total: 119,
    });
    expect(m.unused).toEqual(['$.invoice.totals.rounding', '$.invoice.colour']);
  });

  it('splits arrays, wrappers and JSON Lines', () => {
    expect(splitInput('[{"a":1},{"a":2}]').items).toHaveLength(2);
    expect(splitInput('{"invoices":[{"a":1}]}').items).toHaveLength(1);
    expect(splitInput('{"a":1}\n{"a":2}\n').items).toHaveLength(2);
    expect(splitInput('{"a":').error).toMatch(/not valid JSON/);
    expect(splitInput('  ').error).toMatch(/empty/);
  });

  it('rejects invalid batch members and overflowing JSON numbers', () => {
    expect(splitInput('[null, 1, []]').error).toMatch(/JSON object/);
    expect(splitInput('[]').error).toMatch(/No invoices/);
    expect(splitInput('{"total":1e309}').error).toMatch(/finite numeric range/);
    expect(splitInput(JSON.stringify(Array.from({ length: 251 }, () => ({})))).error).toMatch(/250/);
  });

  it('bounds nesting and rejects cycles before recursive provider mapping', () => {
    let nested: Record<string, unknown> = {};
    for (let i = 0; i < 45; i++) nested = { invoice: nested };
    expect(splitInput(JSON.stringify(nested)).error).toMatch(/nesting/);
    const circular: Record<string, unknown> = {};
    circular.invoice = circular;
    expect(() => mapInvoice(circular)).toThrow(/circular/);
  });

  it('handles malformed provider values with actionable errors', () => {
    expect(() => mapInvoice({ fields: { Items: { type: 'array', valueArray: {} } } })).toThrow(
      /Azure valueArray/,
    );
    expect(() => mapInvoice({ fields: { Items: { type: 'object', valueObject: null } } })).toThrow(
      /Azure valueObject/,
    );
    expect(() =>
      mapInvoice({ entities: [{ type: 'line_item', mentionText: '', properties: [null, 3] }] }),
    ).not.toThrow();
  });

  it('does not silently discard additional Azure documents', () => {
    expect(() => mapInvoice({ documents: [{ fields: {} }, { fields: {} }] })).toThrow(/multiple documents/);
  });

  it('rejects impossible percentages and malformed line or VAT modes', () => {
    const r = lint({
      number: 'X',
      currency: 'EUR',
      prices_include_vat: 'maybe',
      items: [null, { quantity: 1, unit_price: 10, amount: 10, vat_rate: -100, vat_amount: 2 }],
      withholding_rate: '20/10',
      taxes: [3],
    });
    expect(r.mapped.invoice.withholdingRate).toBeUndefined();
    expect(r.mapped.invoice.lines[0].vatRate).toBeUndefined();
    expect(r.findings.filter((f) => f.rule === 'reading' && f.status === 'error')).toHaveLength(5);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });

  it('keeps source and canonical indexes aligned after an invalid line or tax row', () => {
    const r = lint({
      number: 'X',
      currency: 'EUR',
      items: [null, { quantity: 2, unit_price: 10, amount: 15 }],
      taxes: [null, { rate: 20, base: 100, amount: 15 }],
    });
    expect(r.mapped.invoice.lines).toHaveLength(2);
    expect(r.mapped.invoice.taxes).toHaveLength(2);
    expect(r.mapped.sources['lines[1].netAmount']).toBe('$.items[1].amount');
    expect(r.mapped.sources['taxes[1].amount']).toBe('$.taxes[1].amount');
    const lineError = r.findings.find((f) => f.rule === 'line-amount' && f.status === 'error');
    expect(lineError?.fields.every((field) => field.startsWith('lines[1].'))).toBe(true);
    expect(r.findings.find((f) => f.rule === 'tax-amount')?.fields[0]).toBe('taxes[1].amount');
    expect(correctionPrompt(r)).toContain('items[1]');
    expect(correctionPrompt(r)).toContain('taxes[1].amount');
  });
});

describe('checks on the demos', () => {
  it('German invoice: one wrong line, transposed VAT and an OCR IBAN — and no cascade', () => {
    const r = lint(euInvoice);
    expect(r.verdict).toBe('does-not-add-up');
    expect(problems(r).map((f) => f.title)).toEqual([
      'Line 3: quantity × unit price',
      'VAT total',
      'Seller IBAN',
    ]);
    expect(find(r, 'line-amount', 'error')).toMatchObject({
      fields: ['lines[2].netAmount', 'lines[2].quantity', 'lines[2].unitPrice'],
      suggestion: '1,230.00',
    });
    expect(find(r, 'vat-total', 'error')?.cause).toMatch(/transposed/);
    expect(find(r, 'subtotal')).toMatchObject({
      status: 'info',
      message: expect.stringContaining('once line 3 is corrected'),
    });
    expect(find(r, 'total')).toMatchObject({
      status: 'info',
      message: expect.stringContaining('once the VAT total is corrected'),
    });
    expect(find(r, 'reverse-charge')?.status).toBe('info');
  });

  it('Turkish e-Fatura: outdated rate, withholding and VKN', () => {
    const r = lint(trInvoice);
    expect(r.counts).toMatchObject({ error: 3, warning: 2 });
    expect(find(r, 'vat-total', 'error')).toMatchObject({
      fields: ['lines[2].vatRate', 'vatTotal'],
      suggestion: '20%',
    });
    expect(find(r, 'amount-due', 'error')?.cause).toMatch(/withheld VAT was not deducted/);
    expect(find(r, 'withholding')?.status).toBe('pass');
    expect(find(r, 'vat-rate', 'warning')?.message).toMatch(/until 9 Jul 2023/);
    expect(find(r, 'vat-rate', 'warning')?.fields[0]).toBe('lines[2].vatRate');
    expect(r.findings.find((f) => f.title === 'Seller tax number (VKN)')?.status).toBe('error');
    expect(r.findings.find((f) => f.title === 'Buyer tax number (VKN)')?.status).toBe('pass');
    expect(find(r, 'number-year')?.status).toBe('pass');
  });

  it('Azure result: everything adds up', () => {
    const r = lint(azureInvoice);
    expect(r.verdict).toBe('adds-up');
    expect(r.counts.pass).toBe(12);
  });
});

describe('individual checks', () => {
  const base = {
    number: 'X-1',
    date: '2026-10-01',
    due_date: '2026-10-31',
    currency: 'EUR',
    seller: { name: 'S', vat_id: 'DE136695976' },
    items: [
      { description: 'a', quantity: 3, unit_price: 3.33, amount: 9.99, vat_rate: 19 },
      { description: 'b', quantity: 1, unit_price: 10, amount: 10, vat_rate: 7 },
    ],
    subtotal: 19.99,
    vat_total: 2.6,
    total: 22.59,
  };

  it('accepts a correct mixed-rate invoice', () => {
    expect(problems(lint(base))).toEqual([]);
  });

  it('separates rounding differences from real errors', () => {
    const r = lint({ ...base, vat_total: 2.61, total: 22.6 });
    expect(find(r, 'vat-total')?.status).toBe('warning');
    expect(find(r, 'vat-total')?.cause).toMatch(/rounding/);
  });

  it('checks prices that include VAT', () => {
    const r = lint({
      ...base,
      prices_include_vat: true,
      items: [{ description: 'a', quantity: 2, unit_price: 11.9, amount: 23.8, vat_rate: 19 }],
      subtotal: undefined,
      vat_total: undefined,
      total: 23.8,
    });
    expect(find(r, 'total')?.status).toBe('pass');
  });

  it('flags swapped dates, future dates and long terms', () => {
    expect(find(lint({ ...base, due_date: '2026-09-01' }), 'due-date')?.status).toBe('error');
    expect(find(lint({ ...base, date: '2027-01-05', due_date: '2027-02-05' }), 'issue-date')?.status).toBe(
      'warning',
    );
    expect(find(lint({ ...base, due_date: '2027-10-31' }), 'due-date')?.status).toBe('warning');
  });

  it('flags a party copied into the other and a changed bank account', () => {
    const r = lint({
      ...base,
      buyer: { name: 'B', vat_id: 'DE 136 695 976' },
      seller: { ...base.seller, iban: 'DE89370400440532013000' },
      iban: 'GB82WEST12345698765432',
    });
    expect(find(r, 'same-party')?.status).toBe('error');
    expect(find(r, 'iban-mismatch')?.status).toBe('warning');
  });

  it('flags a duplicated line and three-decimal amounts', () => {
    const r = lint({
      ...base,
      items: [...base.items, base.items[1]],
      subtotal: 29.99,
      vat_total: 3.3,
      total: 33.29,
    });
    expect(find(r, 'line-duplicate')?.status).toBe('warning');
    expect(find(lint({ ...base, total: 22.590001 }), 'precision')?.status).toBe('warning');
  });

  it('pinpoints a misread unit price', () => {
    const r = lint({
      ...base,
      items: [
        { description: 'a', quantity: 1, unit_price: 10, amount: 10, vat_rate: 19 },
        { description: 'b', quantity: 4, unit_price: 12.8, amount: 50, vat_rate: 19 },
      ],
    });
    const line = r.findings.find((f) => f.title === 'Line 2: quantity × unit price');
    expect(line).toMatchObject({
      fields: ['lines[1].unitPrice', 'lines[1].netAmount', 'lines[1].quantity'],
      suggestion: '12.50',
    });
    expect(line?.cause).toMatch(/unit price looks wrong.*8 instead of 5/);
  });

  it('does not present an invoice with no arithmetic coverage as clean', () => {
    const result = lint({ number: 'X', currency: 'EUR', date: today });
    expect(result.verdict).toBe('check-warnings');
    expect(find(result, 'insufficient-arithmetic')?.status).toBe('warning');
    expect(() => lintInvoice(base, { today: '2026-02-30' })).toThrow(/real calendar date/);
  });
});

describe('batch and reports', () => {
  const { results, verdicts } = lintBatch(batch, { today });

  it('finds duplicates and every planted problem in the batch', () => {
    expect(verdicts).toEqual({ 'adds-up': 2, 'check-warnings': 2, 'does-not-add-up': 4 });
    expect(find(results[1], 'duplicate-invoice')?.message).toBe(
      'Invoice 2 has the same seller and invoice number as invoice 1.',
    );
    expect(find(results[2], 'due-date')?.status).toBe('error');
    expect(find(results[3], 'total')?.cause).toMatch(/VAT was not added/);
    expect(results[4].findings.find((f) => f.title === 'Seller VAT ID')?.suggestion).toBe('EL094259216');
    expect(results[5].findings[0]).toMatchObject({
      fields: ['lines[0].quantity', 'lines[0].netAmount', 'lines[0].unitPrice'],
      suggestion: '13',
    });
    expect(find(results[6], 'reading')?.message).toMatch(/04 May or 05 Apr/);
    expect(results[7].verdict).toBe('adds-up');
  });

  it('writes JSON, CSV, Markdown and a correction prompt', () => {
    const json = JSON.parse(jsonReport(results));
    expect(json.invoices).toHaveLength(8);
    expect(json.invoices[7].inputFormat).toBe('google');
    const csv = csvReport(results);
    expect(csv.split('\n')[0]).toBe(
      'invoice,invoice_number,status,group,rule,title,field,source,expected,found,message,cause,suggestion',
    );
    expect(csv).not.toMatch(/,pass,/);
    const md = markdownReport(results);
    expect(md).toContain('| 3 | KC-2026-311 | Kettle &amp; Co GmbH |');
    const prompt = correctionPrompt(lint(euInvoice));
    expect(prompt).toContain('line_items[2].amount (line 3 amount)');
    expect(prompt).toContain('the value should be 1230.00');
    expect(correctionPrompt(lint(azureInvoice))).toMatch(/No corrections are suggested/);
  });

  it('neutralises spreadsheet formulas in CSV cells', () => {
    const r = lint({ ...euInvoice, invoice_number: '=HYPERLINK("http://x")' });
    expect(csvReport([r])).toContain(`"'=HYPERLINK(""http://x"")"`);
    r.mapped.invoice.number = '  =1+1';
    expect(csvReport([r])).toContain("'  =1+1");
    r.mapped.invoice.number = '\r=1+1';
    expect(csvReport([r])).toContain("'\r=1+1");
  });

  it('escapes HTML carried by invoice values in Markdown reports', () => {
    const r = lint({ ...euInvoice, invoice_number: '<img src=x onerror=alert(1)>' });
    expect(markdownReport([r])).not.toContain('<img');
    expect(markdownReport([r])).toContain('&lt;img src=x onerror=alert\\(1\\)&gt;');
    r.mapped.invoice.number = '![external](https://example.invalid/pixel)';
    expect(markdownReport([r])).toContain('\\!\\[external\\]\\(https://example.invalid/pixel\\)');
  });
});
