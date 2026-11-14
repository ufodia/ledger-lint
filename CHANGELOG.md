# Changelog

All notable changes to Ledger Lint are documented here. The project follows [Semantic Versioning](https://semver.org/).

## 1.0.0 — 2026-11-14

First public release.

### Added

- Mapping of LLM JSON (English, German and Turkish field names), Azure AI Document Intelligence `prebuilt-invoice` results and Google Document AI entities to one canonical invoice, with source paths for every value.
- Number parsing in both conventions with ambiguity detection; rates as `19`, `"19%"`, `"%20"` or `0.19`; withholding fractions; dates in many formats and languages.
- Arithmetic checks for lines, subtotal, VAT per rate and breakdown, total, prepaid amounts, amount due and KDV tevkifatı, with a rounding tier and no cascading errors.
- VAT rates with validity dates for the EU-27, the UK, Switzerland, Norway and Türkiye; reverse-charge hints.
- IBAN (88 countries), EU VAT numbers (formats; check digits for 12 countries), VKN, TCKN, ETTN and e-Fatura number checks; same-party and changed-IBAN warnings.
- Date checks: impossible, ambiguous, swapped, future, long terms, periods.
- Diagnosis of supported mismatch patterns: decimal separators, transposed and swapped digits, OCR confusions, dropped digits, signs, gross/net, copied fields, missing lines and rate/date issues, with suggested fields to review.
- Browser app with the rebuilt invoice, linked findings, batch table and duplicate detection.
- Correction prompt, Markdown, CSV with formula-leading-cell neutralisation and JSON reports.
- `npm run lint-invoice` command line with `--fail-on` exit codes.
- Four demo extractions, 67 unit/CLI/hosting tests, 12 Playwright browser tests and CI.
- Strict Content-Security-Policy with `connect-src 'none'`.

### Hardened before publication

- Reject malformed separators, invalid rate bounds, unsupported magnitudes and non-finite values; round exponent-form numbers correctly and preserve explicit small withholding percentages.
- Bound input depth, JSON size and batch shape; surface malformed provider objects and multi-document Azure responses without silently discarding invoices.
- Preserve original Azure value wrappers and Google entity/property source paths; link VAT findings to their actual rate fields.
- Apply the same file limits to picker/drop imports and discard stale asynchronous file reads.
- Warn when there is no independent arithmetic coverage; describe tax and identifier findings as bounded review evidence.
- Validate CLI flags and real reference dates; reject input/report path collisions, including existing hard links, before any writes.
- Escape invoice-supplied HTML/Markdown and neutralise whitespace-prefixed CSV formulas.
