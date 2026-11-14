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
- Diagnosis of every mismatch: decimal separators, transposed and swapped digits, OCR confusions, dropped digits, signs, gross/net, copied fields, missing lines and outdated rates — and which line field is wrong.
- Browser app with the rebuilt invoice, linked findings, batch table and duplicate detection.
- Correction prompt, Markdown, CSV (formula-injection safe) and JSON reports.
- `npm run lint-invoice` command line with `--fail-on` exit codes.
- Four demo extractions, 49 unit tests, 9 Playwright browser tests and CI.
- Strict Content-Security-Policy with `connect-src 'none'`.
