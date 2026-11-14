# Architecture

Ledger Lint is a static Vite app plus a small Node command line. Both use the same engine in `src/core`, which has no DOM access and no runtime dependencies.

```
src/
├── core/
│   ├── numbers.ts    amount, rate and fraction parsing; half-up rounding; currency minor units
│   ├── input.ts      shared JSON, nesting, batch and resource limits
│   ├── dates.ts      date parsing in many conventions; ambiguity and validity
│   ├── ids.ts        IBAN, EU VAT numbers, VKN, TCKN, UUID, e-Fatura numbers
│   ├── rates.ts      VAT rates by country with validity dates
│   ├── model.ts      the canonical Invoice, Party, Line and TaxRow types
│   ├── map.ts        supported JSON → Invoice (+ source paths, raw strings, notes, unused fields)
│   ├── diagnose.ts   error signatures for mismatching numbers and sums
│   ├── lint.ts       every check → findings, counts, verdict
│   ├── batch.ts      many invoices; duplicate detection
│   └── report.ts     Markdown, CSV, JSON and the correction prompt
├── demo.ts           the four demo extractions
├── main.ts           browser UI: input, rebuilt invoice, findings, batch table, exports
├── dom.ts            text-only element helper (never parses HTML)
└── cli.ts            `npm run lint-invoice`
```

## Data flow

```
JSON text ─► splitInput ─► items ─► lintBatch ─► lintInvoice(item) ─► mapInvoice ─► Mapped
                                         │                 │
                                         │                 └─ checks + diagnose ─► Finding[]
                                         └─ duplicates across items
                                                         ─► LintResult[] ─► UI, reports, exit code
```

### `Mapped`

```ts
interface Mapped {
  invoice: Invoice;                  // canonical: amounts as numbers, rates as percentages, dates as yyyy-mm-dd
  sources: Record<string, string>;   // "lines[2].netAmount" → "$.line_items[2].amount"
  raw: Record<string, string>;       // canonical path → the string a value was parsed from
  notes: Note[];                     // parse errors and ambiguities
  unused: string[];                  // input paths that were not mapped
  format: 'generic' | 'azure' | 'google';
  decimal: '.' | ',';                // convention used for ambiguous strings
}
```

### `Finding`

```ts
interface Finding {
  id: string;                        // "line-amount:lines[2].netAmount"
  rule: string;                      // line-amount, subtotal, vat-total, identifier, due-date, …
  status: 'error' | 'warning' | 'info' | 'pass';
  group: 'arithmetic' | 'tax' | 'identifiers' | 'dates' | 'document';
  title: string;
  fields: string[];                  // canonical paths; the first is the most likely culprit
  message: string;
  expected?: string;
  found?: string;
  cause?: string;                    // the diagnosis
  suggestion?: string;               // the corrected value to propose
}
```

`LintResult` holds the `Mapped` input, the findings sorted by status, the counts per status and the verdict.

Entry points reject unsupported structures before recursive mapping. Library callers should catch validation errors. Provider normalization preserves Azure typed-value wrapper paths and Google entity/property indexes rather than inventing normalized field locations. Google money/date sources point to their composite input object. See [method](method.md) for limits and precision boundaries.

## The browser app

`main.ts` keeps the results, the selected invoice, the selected finding and the “all checks” toggle in module variables and re-renders the workspace with `h()`. Every value from the input becomes a text node, so markup in an invoice is displayed, never interpreted. Field cells carry `data-field` with their canonical path; findings and cells are linked through those paths.

File-picker and drag/drop imports use the same size guard. A version token discards a completed asynchronous file read if the user has edited the input or started another check in the meantime. Read/validation errors remain visible and recoverable in the input form.

## The command line

`cli.ts` runs under `tsx`: it reads the files, splits each into invoices, runs `lintBatch`, writes the requested reports and the correction prompt, prints Markdown and sets the exit code.

Report paths are compared with input and other report paths before writes using lexical/real paths and existing file identities, preventing accidental input overwrite through common aliases or hard links. This is a local-tool guard, not protection against an adversary changing filesystem links during a run.

## Library use

```ts
import { lintInvoice } from './src/core/lint.ts';
import { lintBatch } from './src/core/batch.ts';
import { correctionPrompt, jsonReport } from './src/core/report.ts';

const result = lintInvoice(extractedJson, { today: '2026-11-14', decimal: ',' });
```

## Tests

- `tests/core.test.ts` — parsing, identifiers against published examples, rate validity, diagnosis signatures, all input formats, every planted demo error, individual checks (rounding tier, prices including VAT, dates, same party, changed IBAN, duplicates, precision, misread unit price), batches and reports.
- `tests/hosting.test.mjs` — the production hosting script.
- `tests/cli.test.ts` — unknown options, date validation, exit codes and report/input collision protection.
- `e2e/app.spec.ts` — the real app in Chromium: demos, field/finding linking, Turkish formatting, the clean Azure result, batch navigation, input errors, JSON Lines and files, the clipboard prompt and exports, no off-origin requests and the phone layout.
